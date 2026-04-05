import { webResearch } from './webResearch.js';
import { saveLearningEntry } from './learningStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [deepResearch] ${label}`, data ?? '');
}

// The research agent ends its ANSWER with a structured block for reliable extraction.
// Multiple sources are supported — one per SOURCE line, pipe-delimited: url | title | type
const STRUCTURED_GOAL_SUFFIX = `
At the end of your ANSWER, after a line containing only "---", include this block:
SOURCES: <url1> | <title1> | <type1>
SOURCES: <url2> | <title2> | <type2>
(add one SOURCES line per relevant resource found, up to 5)
ENTRY_POINT: <specific section, chapter, timestamp, or starting point for this topic>
CONCEPTS: <key concept 1> | <key concept 2> | <key concept 3> | ...

Types: article, documentation, video, tutorial, community
Include a SOURCES line for every distinct resource you fetched or cited.

Example:
---
SOURCES: https://example.com/guide | Complete Guide to X | tutorial
SOURCES: https://docs.example.com | Official X Documentation | documentation
ENTRY_POINT: Start at Chapter 2 — introduces the core concepts directly
CONCEPTS: concept A | concept B | concept C | concept D`;

function parseStructuredAnswer(raw) {
  const sepIdx = raw.lastIndexOf('\n---');
  const narrative = sepIdx > -1 ? raw.slice(0, sepIdx).trim() : raw.trim();
  const block = sepIdx > -1 ? raw.slice(sepIdx) : '';

  const get = (field) => {
    const m = block.match(new RegExp(`^${field}:\\s*(.+)`, 'im'));
    return m ? m[1].trim() : null;
  };

  // Parse all SOURCES lines
  const sourcesRaw = [...block.matchAll(/^SOURCES:\s*(.+)/gim)].map(m => m[1].trim());
  const sources = sourcesRaw.map(line => {
    const parts = line.split('|').map(p => p.trim());
    return { url: parts[0] || null, title: parts[1] || null, type: parts[2] || null };
  }).filter(s => s.url || s.title);

  const conceptsRaw = get('CONCEPTS');
  const keyConcepts = conceptsRaw
    ? conceptsRaw.split(/\s*\|\s*/).map(c => c.trim()).filter(Boolean)
    : [];

  return {
    narrative,
    sources,
    entryPoint: get('ENTRY_POINT'),
    keyConcepts
  };
}

// Called from callTool — context carries userId and session.
export async function deepResearch(args, context = {}, onStatus = () => {}) {
  const { topic, goal, linkedProjects } = args;
  if (!topic?.trim() || !goal?.trim()) throw new Error('topic and goal are required');

  const userId = context.userId;
  const iterations = config.tools?.learning?.deepResearchIterations ?? 10;

  log('start', `topic="${topic}" userId=${userId}`);

  const rawAnswer = await webResearch(
    { topic, goal, maxIterationsOverride: iterations, answerSuffix: STRUCTURED_GOAL_SUFFIX },
    onStatus
  );

  const { narrative, sources, entryPoint, keyConcepts } = parseStructuredAnswer(rawAnswer);
  log('parsed', `sources=${sources.length} concepts=${keyConcepts.length} entryPoint=${!!entryPoint}`);

  if (userId) {
    try {
      const result = saveLearningEntry(userId, {
        topic,
        sources,
        keyConcepts,
        entryPoint,
        relevance: narrative,
        linkedProjects: Array.isArray(linkedProjects) ? linkedProjects : []
      });
      log('saved', result);
    } catch (err) {
      log('save-error', err.message);
    }
  }

  const lines = [`Research complete: ${topic}`];
  if (sources.length) lines.push(`Sources: ${sources.map(s => s.title ?? s.url).join(', ')}`);
  if (entryPoint) lines.push(`Entry point: ${entryPoint}`);
  if (keyConcepts.length) lines.push(`Key concepts: ${keyConcepts.join(', ')}`);
  lines.push('', narrative);

  return lines.join('\n');
}
