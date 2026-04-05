import { webResearch } from './webResearch.js';
import { saveLearningEntry } from './learningStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [deepResearch] ${label}`, data ?? '');
}

// The research agent is asked to end with a structured block so we can
// extract source, entry point, and concepts reliably without depending
// on the chat LLM to carry tool result content into a second tool call.
const STRUCTURED_GOAL_SUFFIX = `

At the end of your ANSWER, after a line containing only "---", include this block (fill in each field):
SOURCE_URL: <the single best URL you found>
SOURCE_TITLE: <title of that resource>
SOURCE_TYPE: <article | documentation | video | tutorial | community>
ENTRY_POINT: <the specific section, chapter, timestamp, or starting point most relevant for this topic>
CONCEPTS: <3-6 key concepts or takeaways, separated by " | ">

Example:
---
SOURCE_URL: https://example.com/article
SOURCE_TITLE: Guide to X
SOURCE_TYPE: tutorial
ENTRY_POINT: Start at section 2 — covers the core technique directly
CONCEPTS: concept A | concept B | concept C`;

function parseStructuredAnswer(raw) {
  const sepIdx = raw.lastIndexOf('\n---');
  const narrative = sepIdx > -1 ? raw.slice(0, sepIdx).trim() : raw.trim();
  const block = sepIdx > -1 ? raw.slice(sepIdx) : '';

  const get = (field) => {
    const m = block.match(new RegExp(`${field}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : null;
  };

  const conceptsRaw = get('CONCEPTS');
  const keyConcepts = conceptsRaw
    ? conceptsRaw.split(/\s*\|\s*/).map(c => c.trim()).filter(Boolean)
    : [];

  const url = get('SOURCE_URL');
  const title = get('SOURCE_TITLE');
  const type = get('SOURCE_TYPE');

  return {
    narrative,
    source: (url || title) ? { url: url ?? null, title: title ?? null, type: type ?? null } : null,
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

  const structuredGoal = goal + STRUCTURED_GOAL_SUFFIX;

  const rawAnswer = await webResearch(
    { topic, goal: structuredGoal, maxIterationsOverride: iterations },
    onStatus
  );

  const { narrative, source, entryPoint, keyConcepts } = parseStructuredAnswer(rawAnswer);
  log('parsed', `source=${source?.url ?? 'none'} concepts=${keyConcepts.length} entryPoint=${!!entryPoint}`);

  // Auto-save if we have a userId — don't rely on the chat LLM to do it
  if (userId) {
    try {
      const result = saveLearningEntry(userId, {
        topic,
        source,
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

  // Return a concise summary to the chat LLM — it doesn't need the full structured block
  const lines = [`Research complete: ${topic}`];
  if (source?.url) lines.push(`Source: ${source.title ?? source.url} — ${source.url}`);
  if (entryPoint) lines.push(`Entry point: ${entryPoint}`);
  if (keyConcepts.length) lines.push(`Key concepts: ${keyConcepts.join(', ')}`);
  lines.push('', narrative);

  return lines.join('\n');
}
