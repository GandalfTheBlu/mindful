import { complete } from '../llm.js';
import { queryMemories } from '../core/vectraStore.js';
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

const FILTER_SYSTEM = `/no_think
You are given a conversation context and numbered candidate memories. Output ONLY the numbers of memories that directly relate to the topic at hand and would meaningfully change the response. Memories that merely share a subject area do not qualify. Be conservative — if in doubt, exclude. Output comma-separated numbers only. If none qualify, output nothing.`;

export async function retrieve(session, userContent) {
  const { retrievalWindowChars, maxInjectedMemories } = config.memory;

  // Build deduplication set from memories already explicitly injected into context
  const alreadyInContext = new Set(
    session.messages.flatMap(m => m.injectedMemories ?? [])
  );

  // --- Targeted retrieval ---
  const userMessagesText = session.messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n')
    .slice(-retrievalWindowChars);

  const { userId } = session;

  let injected = [];
  if (userContent.trim().length >= 20) {
    const expandedQuery = await expandQuery(userMessagesText, userContent);
    log('expanded-query', expandedQuery);
    const candidates = await queryMemories(userId, expandedQuery, maxInjectedMemories);
    log('candidates', candidates.length > 0 ? candidates : '(none)');

    if (candidates.length > 0) {
      const numbered = candidates.map((m, i) => `${i + 1}. ${m}`).join('\n');
      const response = await complete(
        [
          { role: 'system', content: FILTER_SYSTEM },
          { role: 'user', content: `Context:\n${userMessagesText}\n\nMemories:\n${numbered}` }
        ],
        { max_tokens: config.memory.maxTokens }
      );
      log('filter-response', response.trim() || '(empty)');

      const indices = (response.match(/\d+/g) ?? [])
        .map(n => parseInt(n) - 1)
        .filter(i => i >= 0 && i < candidates.length);

      injected = indices.map(i => candidates[i]).filter(m => !alreadyInContext.has(m));
    }
  }

  log('injected', injected.length > 0 ? injected : '(none)');

  return { injected };
}
