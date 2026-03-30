import config from '../config.js';
import { summarize } from './summarizer.js';
import { retrieveMemories } from './memoryRetriever.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] ${label}`, data ?? '');
}

const maxChars = config.llm.contextSize * config.contextHorizon.charsPerToken;
const horizonThreshold = maxChars * config.contextHorizon.summarizeAtPercent;

const KEEP_RECENT = 4;

function sessionChars(messages) {
  return messages.reduce((sum, m) => sum + (m.llmContent ?? m.content).length, 0);
}

async function condenseIfNeeded(session) {
  if (sessionChars(session.messages) <= horizonThreshold) return;

  const toSummarize = session.messages.slice(0, -KEEP_RECENT);
  const toKeep = session.messages.slice(-KEEP_RECENT);
  if (toSummarize.length === 0) return;

  const summaryText = await summarize(toSummarize);
  session.messages = [
    { role: 'system', content: `[Summary of earlier conversation]: ${summaryText}`, isSummary: true },
    ...toKeep
  ];
}

// Called before sending to LLM. Mutates session by appending the user message.
// Returns { llmMessages, userMsg }.
export async function processMessage(session, userContent) {
  const { retrievalWindowChars } = config.memory;

  // Build retrieval query from recent conversation + new message
  const recentText = session.messages
    .map(m => m.content)
    .join('\n')
    .slice(-retrievalWindowChars);

  // Deduplicate against memories already in the current context window,
  // either injected from Vectra or extracted from the user's own messages
  const alreadyInContext = new Set(
    session.messages.flatMap(m => [
      ...(m.injectedMemories ?? []),
      ...(m.extractedMemories ?? [])
    ])
  );

  const memories = (await retrieveMemories(recentText + '\n' + userContent))
    .filter(m => !alreadyInContext.has(m));

  log('memory:injecting', memories.length > 0 ? memories : '(none — all filtered or empty)');

  // Condense history if approaching horizon
  await condenseIfNeeded(session);

  // Build llmContent for the new user message
  const llmContent = memories.length > 0
    ? `${userContent}\n\n[Relevant memories]:\n${memories.join('\n')}`
    : userContent;

  const userMsg = {
    role: 'user',
    content: userContent,    // clean — for display
    llmContent,              // with injected memories — for LLM context
    injectedMemories: memories,
    extractedMemories: []
  };
  session.messages.push(userMsg);

  // Build LLM message array using llmContent where present
  const llmMessages = session.messages.map(m => ({
    role: m.role,
    content: m.llmContent ?? m.content
  }));

  return { llmMessages, userMsg };
}
