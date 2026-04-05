import { complete } from '../llm.js';
import { queryMemories, listByType } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [retrieve] ${label}`, data ?? '');
}

const EXPAND_SYSTEM = `/no_think
Given a conversation and the latest user message, write a short search query (under 20 words) describing what personal information about the user would be most useful to recall from memory. Include specific topics, skills, hobbies, preferences, or names that seem relevant to answering the message. Output only the search query, nothing else.`;

async function expandQuery(userMessagesText, userContent) {
  const response = await complete(
    [
      { role: 'system', content: EXPAND_SYSTEM },
      { role: 'user', content: `Previous user messages:\n${userMessagesText}\n\nLatest message: ${userContent}` }
    ],
    { max_tokens: 60 }
  );
  return response.trim() || userContent;
}

// Minimum cosine score for a candidate to reach the filter LLM.
// Sits above the store-level minSimilarity noise floor; configurable via memory.retrieveMinScore.
const RETRIEVE_MIN_SCORE = () => config.memory.retrieveMinScore ?? 0.6;

const FILTER_SYSTEM = `/no_think
You are given a user message and numbered candidate memories with their similarity scores (0–1). Output ONLY the numbers of memories that provide specific information directly needed to respond well to this exact message — not merely about the same subject area.

Ask yourself: would the response be noticeably more accurate or personal with this memory than without it? If the answer is not clearly yes, exclude it.

Be strict. Scores below 0.70 require clear justification to include. Output comma-separated numbers only. If none qualify, output nothing.`;

export async function retrieve(session, userContent) {
  const { retrievalWindowChars, maxInjectedMemories } = config.memory;
  const { uncertainThreshold } = config.confidence ?? { uncertainThreshold: 0.5 };

  const alreadyInContext = new Set(
    session.messages.flatMap(m => m.injectedMemories ?? [])
  );

  const userMessagesText = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n')
    .slice(-retrievalWindowChars);

  const { userId } = session;

  let injected = [];
  let expandedQuery = userContent;
  if (userContent.trim().length >= 20) {
    expandedQuery = await expandQuery(userMessagesText, userContent);
    log('expanded-query', expandedQuery);

    // Fetch a wider pool, then hard-threshold on score before the LLM filter.
    // This gives the filter better candidates and cuts noise that merely shares vocabulary.
    const pool = await queryMemories(userId, expandedQuery, maxInjectedMemories * 4);
    const candidates = pool.filter(c => (c.score ?? 0) >= RETRIEVE_MIN_SCORE());
    log('candidates', `${pool.length} fetched, ${candidates.length} above score threshold`);
    if (candidates.length > 0) log('candidate-list', candidates.map(c => `[${c.score?.toFixed(2)}] ${c.text}`));

    if (candidates.length > 0) {
      const numbered = candidates.map((c, i) => `${i + 1}. [score:${c.score?.toFixed(2)}] ${c.text}`).join('\n');
      const response = await complete(
        [
          { role: 'system', content: FILTER_SYSTEM },
          { role: 'user', content: `User message: ${userContent}\n\nCandidates:\n${numbered}` }
        ],
        { max_tokens: config.memory.maxTokens }
      );
      log('filter-response', response.trim() || '(empty)');

      const indices = (response.match(/\d+/g) ?? [])
        .map(n => parseInt(n) - 1)
        .filter(i => i >= 0 && i < candidates.length);

      injected = indices
        .map(i => candidates[i])
        .filter(c => !alreadyInContext.has(c.text))
        .slice(0, maxInjectedMemories);
    }
  }

  const injectedTexts = injected.map(c => c.text);
  const injectedFormatted = injected.map(c =>
    c.confidence < uncertainThreshold ? `[uncertain] ${c.text}` : c.text
  );

  log('injected', injectedTexts.length > 0 ? injectedTexts : '(none)');

  // Procedural memories are always injected into the system prompt regardless of the current topic
  const procedural = await listByType(userId, 'procedural');
  if (procedural.length > 0) log('procedural', procedural);

  return { injected: injectedTexts, injectedFormatted, procedural, expandedQuery };
}
