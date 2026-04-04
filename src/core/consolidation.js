import { listAllItems, deleteItems, replaceItems } from './vectraStore.js';
import { complete } from '../llm.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [consolidation] ${label}`, data ?? '');
}

// Strip and re-attach the [YYYY-MM-DD] date tag so consolidation LLM calls
// never see or hallucinate dates, and merged results always carry today's date.
const DATE_TAG = /\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]$/;

function stripDate(text) {
  return text.replace(DATE_TAG, '');
}

function redate(text) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return `${stripDate(text)} [${now}]`;
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

  const toDeleteItems = items.filter(item => {
    const accessCount = item.metadata.accessCount ?? 0;
    const lastAccessed = item.metadata.lastAccessed ?? item.metadata.createdAt ?? 0;
    const confidence = item.metadata.confidence ?? 1.0;
    if (confidence < uncertainThreshold && accessCount === 0 && lastAccessed < fastCutoff) return true;
    return accessCount === 0 && lastAccessed < cutoff;
  });

  if (toDeleteItems.length > 0) {
    const lines = toDeleteItems.map(i => `  - ${i.metadata.text}`).join('\n');
    log('decay', `expired ${toDeleteItems.length} memories:\n${lines}`);
    await deleteItems(userId, toDeleteItems.map(i => i.id));
  }

  return toDeleteItems.length;
}

// --- Pass 2: Redundancy ---
// Merge near-duplicate memories (cosine >= redundancyThreshold) into single statements.
const MERGE_SYSTEM = `/no_think
Merge these related memory statements into one precise, concise statement starting with "The user". Preserve all distinct information but eliminate repetition. Output only the merged statement, nothing else.`;

async function redundancyPass(userId, items) {
  const clusters = clusterBySimilarity(items, config.consolidation.redundancyThreshold);
  if (clusters.length === 0) return 0;

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
    const clusterType = cluster[0].metadata.type ?? 'semantic';
    const datedMerge = redate(mergedText);
    const sources = cluster.map(i => `  - ${i.metadata.text}`).join('\n');
    log('redundancy', `merged ${cluster.length} memories:\n${sources}\n  → ${datedMerge}`);
    await replaceItems(userId, cluster.map(i => i.id), datedMerge, avgConfidence, clusterType);
    cluster.forEach(item => processed.add(item.id));
    merged++;
  }

  return merged;
}

// --- Pass 3: Contradiction ---
// Detect and resolve memories that directly contradict each other.
const CONTRADICTION_DETECT_SYSTEM = `/no_think
Review these numbered memory statements. Identify pairs that cannot both be currently true:
- Direct factual contradictions: one statement makes the other factually impossible.
- Temporal superseding: one statement describes a state that has clearly been resolved or replaced by another (e.g. was struggling with something that the other statement says is now resolved).
Two different facts about the same topic are NOT contradictions. Output only the conflicting index pairs as "X vs Y", one per line. If none, output NONE.`;

const CONTRADICTION_RESOLVE_SYSTEM = `/no_think
These two memory statements contradict each other. Statement B is more recent than statement A. Prefer the more recent information (B) unless A is clearly more specific or detailed. If the user explicitly updated their position (phrases like "actually", "changed my mind", "now I"), keep only B. Start with "The user". Output only the revised statement, nothing else.`;

async function contradictionPass(userId, items) {
  if (items.length > config.consolidation.maxMemoriesForContradictionCheck) {
    log('contradiction:skip', `${items.length} items exceeds limit`);
    return 0;
  }

  // Sort by createdAt ascending so that when the LLM picks between A and B,
  // B is always the more recent statement (as the resolve prompt promises).
  const sorted = [...items].sort((a, b) => (a.metadata.createdAt ?? 0) - (b.metadata.createdAt ?? 0));

  const numbered = sorted.map((item, i) => `${i + 1}. ${stripDate(item.metadata.text)}`).join('\n');
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

  const processed = new Set();
  let resolved = 0;

  for (const [a, b] of pairs) {
    if (processed.has(sorted[a].id) || processed.has(sorted[b].id)) continue;

    const result = await complete(
      [
        { role: 'system', content: CONTRADICTION_RESOLVE_SYSTEM },
        { role: 'user', content: `A: ${stripDate(sorted[a].metadata.text)}\nB: ${stripDate(sorted[b].metadata.text)}` }
      ],
      { max_tokens: config.memory.maxTokens }
    );
    const resolvedText = result.trim();
    if (!resolvedText) continue;

    const resolvedConfidence = sorted[b].metadata.confidence ?? 1.0;
    const resolvedType = sorted[b].metadata.type ?? 'semantic';
    const datedResolution = redate(resolvedText);
    log('contradiction', `resolved conflict:\n  A: ${sorted[a].metadata.text}\n  B: ${sorted[b].metadata.text}\n  → ${datedResolution}`);
    await replaceItems(userId, [sorted[a].id, sorted[b].id], datedResolution, resolvedConfidence, resolvedType);
    processed.add(sorted[a].id);
    processed.add(sorted[b].id);
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
    const clusterType = cluster[0].metadata.type ?? 'semantic';
    const datedAbstraction = redate(abstractText);
    const sources = cluster.map(i => `  - ${i.metadata.text}`).join('\n');
    log('abstraction', `abstracted ${cluster.length} memories:\n${sources}\n  → ${datedAbstraction}`);
    await replaceItems(userId, cluster.map(i => i.id), datedAbstraction, minConfidence, clusterType);
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
