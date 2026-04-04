import { listAllItems, deleteItems, replaceItems } from './vectraStore.js';
import { complete } from '../llm.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [consolidation] ${label}`, data ?? '');
}

// Strip and re-attach the [YYYY-MM-DD] date tag so consolidation LLM calls
// never see or hallucinate dates, and merged results always carry today's date.
const DATE_TAG = /\s*\[\d{4}-\d{2}-\d{2}\]$/;

function stripDate(text) {
  return text.replace(DATE_TAG, '');
}

function redate(text) {
  return `${stripDate(text)} [${new Date().toISOString().slice(0, 10)}]`;
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.vector.length; i++) dot += a.vector[i] * b.vector[i];
  return dot / (a.norm * b.norm);
}

// Union-find clustering: returns groups of items with mutual similarity >= threshold
function clusterBySimilarity(items, threshold) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineSim(items[i], items[j]) >= threshold) {
        parent[find(i)] = find(j);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(items[i]);
  }

  return [...clusters.values()].filter(c => c.length >= 2);
}

// --- Pass 1: Decay ---
// Remove memories that were never accessed and are older than decayAgeDays.
async function decayPass(userId, items) {
  const cutoff = Date.now() - config.consolidation.decayAgeDays * 86_400_000;
  const fastDecayAgeDays = config.confidence?.fastDecayAgeDays ?? 3;
  const uncertainThreshold = config.confidence?.uncertainThreshold ?? 0.5;
  const fastCutoff = Date.now() - fastDecayAgeDays * 86_400_000;

  const toDelete = items
    .filter(item => {
      const accessCount = item.metadata.accessCount ?? 0;
      const lastAccessed = item.metadata.lastAccessed ?? item.metadata.createdAt ?? 0;
      const confidence = item.metadata.confidence ?? 1.0;
      // Fast-decay: low-confidence, never accessed, older than fastDecayAgeDays
      if (confidence < uncertainThreshold && accessCount === 0 && lastAccessed < fastCutoff) return true;
      // Normal decay: never accessed, older than decayAgeDays
      return accessCount === 0 && lastAccessed < cutoff;
    })
    .map(item => item.id);

  if (toDelete.length > 0) {
    log('decay:removing', toDelete.length);
    await deleteItems(userId, toDelete);
  }

  return toDelete.length;
}

// --- Pass 2: Redundancy ---
// Merge near-duplicate memories (cosine >= redundancyThreshold) into single statements.
const MERGE_SYSTEM = `/no_think
Merge these related memory statements into one precise, concise statement starting with "The user". Preserve all distinct information but eliminate repetition. Output only the merged statement, nothing else.`;

async function redundancyPass(userId, items) {
  const clusters = clusterBySimilarity(items, config.consolidation.redundancyThreshold);
  if (clusters.length === 0) return 0;
  log('redundancy:clusters', clusters.length);

  const processed = new Set();
  let merged = 0;

  for (const cluster of clusters) {
    if (cluster.some(item => processed.has(item.id))) continue;

    const texts = cluster.map((item, i) => `${i + 1}. ${stripDate(item.metadata.text)}`).join('\n');
    const result = await complete(
      [
        { role: 'system', content: MERGE_SYSTEM },
        { role: 'user', content: texts }
      ],
      { max_tokens: config.memory.maxTokens }
    );
    const mergedText = result.trim();
    if (!mergedText) continue;

    const avgConfidence = cluster.reduce((s, i) => s + (i.metadata.confidence ?? 1.0), 0) / cluster.length;
    const datedMerge = redate(mergedText);
    log('redundancy:merged', datedMerge);
    await replaceItems(userId, cluster.map(i => i.id), datedMerge, avgConfidence);
    cluster.forEach(item => processed.add(item.id));
    merged++;
  }

  return merged;
}

// --- Pass 3: Contradiction ---
// Detect and resolve memories that directly contradict each other.
const CONTRADICTION_DETECT_SYSTEM = `/no_think
Review these numbered memory statements. Identify direct factual contradictions — where one statement makes the other factually impossible (e.g. "hates coffee" vs "loves coffee", "lives in Paris" vs "lives in Berlin"). Two different facts about the same topic are NOT contradictions. Output only the conflicting index pairs as "X vs Y", one per line. If none, output NONE.`;

const CONTRADICTION_RESOLVE_SYSTEM = `/no_think
These two memory statements contradict each other. Statement B is more recent than statement A. Prefer the more recent information (B) unless A is clearly more specific or detailed. If the user explicitly updated their position (phrases like "actually", "changed my mind", "now I"), keep only B. Start with "The user". Output only the revised statement, nothing else.`;

async function contradictionPass(userId, items) {
  if (items.length > config.consolidation.maxMemoriesForContradictionCheck) {
    log('contradiction:skip', `${items.length} items exceeds limit`);
    return 0;
  }

  const numbered = items.map((item, i) => `${i + 1}. ${stripDate(item.metadata.text)}`).join('\n');
  const response = await complete(
    [
      { role: 'system', content: CONTRADICTION_DETECT_SYSTEM },
      { role: 'user', content: numbered }
    ],
    { max_tokens: config.memory.maxTokens }
  );

  if (!response.trim() || response.includes('NONE')) return 0;

  const pairs = [];
  const pairPattern = /(\d+)\s+vs\.?\s+(\d+)/gi;
  let match;
  while ((match = pairPattern.exec(response)) !== null) {
    const a = parseInt(match[1]) - 1;
    const b = parseInt(match[2]) - 1;
    if (a >= 0 && a < items.length && b >= 0 && b < items.length && a !== b) {
      pairs.push([a, b]);
    }
  }

  if (pairs.length === 0) return 0;
  log('contradiction:pairs', pairs.length);

  const processed = new Set();
  let resolved = 0;

  for (const [a, b] of pairs) {
    if (processed.has(items[a].id) || processed.has(items[b].id)) continue;

    const result = await complete(
      [
        { role: 'system', content: CONTRADICTION_RESOLVE_SYSTEM },
        { role: 'user', content: `A: ${stripDate(items[a].metadata.text)}\nB: ${stripDate(items[b].metadata.text)}` }
      ],
      { max_tokens: config.memory.maxTokens }
    );
    const resolvedText = result.trim();
    if (!resolvedText) continue;

    const resolvedConfidence = items[b].metadata.confidence ?? 1.0;
    const datedResolution = redate(resolvedText);
    log('contradiction:resolved', datedResolution);
    await replaceItems(userId, [items[a].id, items[b].id], datedResolution, resolvedConfidence);
    processed.add(items[a].id);
    processed.add(items[b].id);
    resolved++;
  }

  return resolved;
}

// --- Pass 4: Abstraction ---
// Replace thematic clusters of specific memories with a single generalization.
const ABSTRACT_SYSTEM = `/no_think
These memory statements share a common theme. Write one general statement that captures the overall pattern. Start with "The user". Output only the statement, nothing else.`;

async function abstractionPass(userId, items) {
  const { abstractionThreshold, abstractionMinClusterSize } = config.consolidation;
  const clusters = clusterBySimilarity(items, abstractionThreshold)
    .filter(c => c.length >= abstractionMinClusterSize);

  if (clusters.length === 0) return 0;
  log('abstraction:clusters', clusters.length);

  const processed = new Set();
  let abstracted = 0;

  for (const cluster of clusters) {
    if (cluster.some(item => processed.has(item.id))) continue;

    const texts = cluster.map((item, i) => `${i + 1}. ${stripDate(item.metadata.text)}`).join('\n');
    const result = await complete(
      [
        { role: 'system', content: ABSTRACT_SYSTEM },
        { role: 'user', content: texts }
      ],
      { max_tokens: config.memory.maxTokens }
    );
    const abstractText = result.trim();
    if (!abstractText) continue;

    const minConfidence = Math.min(...cluster.map(i => i.metadata.confidence ?? 1.0));
    const datedAbstraction = redate(abstractText);
    log('abstraction:abstracted', datedAbstraction);
    await replaceItems(userId, cluster.map(i => i.id), datedAbstraction, minConfidence);
    cluster.forEach(item => processed.add(item.id));
    abstracted++;
  }

  return abstracted;
}

// --- Orchestrator ---
export async function runConsolidation(userId) {
  const { minMemoriesForLLMPasses } = config.consolidation;

  let items = await listAllItems(userId);
  if (items.length === 0) return;

  log('start', `[${userId}] ${items.length} memories`);

  // Pass 1: Decay — always runs, no LLM
  const decayed = await decayPass(userId, items);
  if (decayed > 0) items = await listAllItems(userId);

  // Passes 2–4 only if enough memories remain
  if (items.length < minMemoriesForLLMPasses) {
    log('done', 'skipping LLM passes (too few memories)');
    return;
  }

  // Pass 2: Contradiction — must run before redundancy so genuine updates
  // aren't merged away as near-duplicates before they can be resolved.
  const resolved = await contradictionPass(userId, items);
  if (resolved > 0) items = await listAllItems(userId);

  // Pass 3: Redundancy
  const merged = await redundancyPass(userId, items);
  if (merged > 0) items = await listAllItems(userId);

  // Pass 4: Abstraction
  await abstractionPass(userId, items);

  log('done', '');
}
