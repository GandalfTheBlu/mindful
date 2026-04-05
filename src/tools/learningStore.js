import fs from 'fs';
import path from 'path';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [learningStore] ${label}`, data ?? '');
}

function learningDir(userId) {
  return path.join(config.learning.dataDir, userId);
}

function indexPath(userId) {
  return path.join(learningDir(userId), 'index.json');
}

function entryPath(userId, id) {
  return path.join(learningDir(userId), `${id}.md`);
}

function ensureDir(userId) {
  fs.mkdirSync(learningDir(userId), { recursive: true });
}

function readIndex(userId) {
  const p = indexPath(userId);
  if (!fs.existsSync(p)) return { entries: [], sessions: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { entries: [], sessions: [] }; }
}

function writeIndex(userId, index) {
  ensureDir(userId);
  fs.writeFileSync(indexPath(userId), JSON.stringify(index, null, 2), 'utf8');
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function renderMarkdown(entry) {
  const sourceStr = entry.source?.url
    ? `[${entry.source.title ?? entry.source.url}](${entry.source.url})${entry.source.type ? ` — ${entry.source.type}` : ''}`
    : entry.source?.title ?? '(no source)';

  const lines = [
    `# ${entry.topic}`,
    `**Date:** ${entry.date}`,
    `**Source:** ${sourceStr}`,
    '',
    '## Key Concepts',
    ...(entry.keyConcepts ?? []).map(c => `- ${c}`),
    '',
    '## Entry Point',
    entry.entryPoint ?? '(none)',
    '',
    '## Why This Matters',
    entry.relevance ?? '(none)',
  ];

  if (entry.linkedProjects?.length > 0) {
    lines.push('', '## Linked Projects', ...entry.linkedProjects.map(p => `- ${p}`));
  }

  if (entry.connections?.length > 0) {
    lines.push('', '## Connections', ...entry.connections.map(c => `- ${c.id}: ${c.note}`));
  }

  return lines.join('\n');
}

// --- Tool implementations ---

export function saveLearningEntry(userId, args) {
  const { topic, source, keyConcepts, entryPoint, relevance, linkedProjects } = args;
  if (!topic?.trim()) throw new Error('topic is required');

  const date = new Date().toISOString().slice(0, 10);
  const id = `${date}-${slugify(topic)}`;

  const entry = {
    id,
    date,
    topic: topic.trim(),
    source: source ?? null,
    keyConcepts: Array.isArray(keyConcepts) ? keyConcepts : [],
    entryPoint: entryPoint ?? null,
    relevance: relevance ?? null,
    linkedProjects: Array.isArray(linkedProjects) ? linkedProjects : [],
    connections: []
  };

  ensureDir(userId);
  fs.writeFileSync(entryPath(userId, id), renderMarkdown(entry), 'utf8');

  const index = readIndex(userId);
  // Remove any existing entry with same id (re-run guard)
  index.entries = index.entries.filter(e => e.id !== id);
  index.entries.push({ id, date, topic: entry.topic, linkedProjects: entry.linkedProjects });
  writeIndex(userId, index);

  log('saved', id);
  return `Saved learning entry: ${id}`;
}

export function listLearningEntries(userId, args = {}) {
  const limit = Math.min(args.limit ?? 10, 50);
  const index = readIndex(userId);
  const recent = index.entries.slice(-limit).reverse();

  if (recent.length === 0) return 'No learning entries yet.';

  return 'Recent learning entries:\n' + recent.map((e, i) =>
    `${i + 1}. [${e.id}] ${e.topic} (${e.date})${e.linkedProjects?.length ? ` — linked to: ${e.linkedProjects.join(', ')}` : ''}`
  ).join('\n');
}

export function linkEntries(userId, args) {
  const { idA, idB, connectionNote } = args;
  if (!idA || !idB || !connectionNote) throw new Error('idA, idB, and connectionNote are required');

  const index = readIndex(userId);
  for (const [self, other] of [[idA, idB], [idB, idA]]) {
    const entry = index.entries.find(e => e.id === self);
    if (!entry) throw new Error(`Entry not found: ${self}`);

    // Append connection note to markdown file
    const p = entryPath(userId, self);
    if (fs.existsSync(p)) {
      let content = fs.readFileSync(p, 'utf8');
      if (!content.includes('## Connections')) {
        content += '\n\n## Connections';
      }
      content += `\n- ${other}: ${connectionNote}`;
      fs.writeFileSync(p, content, 'utf8');
    }
  }

  writeIndex(userId, index);
  log('linked', `${idA} ↔ ${idB}`);
  return `Linked entries: ${idA} ↔ ${idB}`;
}

export function logSession(userId, args = {}) {
  const { entryIds, notes } = args;
  const index = readIndex(userId);
  index.sessions.push({
    date: new Date().toISOString().slice(0, 10),
    entryIds: Array.isArray(entryIds) ? entryIds : [],
    notes: notes ?? null
  });
  writeIndex(userId, index);
  log('session-logged', `entries=${(entryIds ?? []).length}`);
  return 'Learning session logged.';
}

// Used by learningProposal.js — not a tool, just a helper
export function getRecentEntryTopics(userId, limit = 5) {
  const index = readIndex(userId);
  return index.entries.slice(-limit).reverse().map(e => `${e.topic} (${e.date})`);
}
