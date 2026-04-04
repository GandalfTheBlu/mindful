import { complete } from '../llm.js';
import { queryMemories } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [retrieve] ${label}`, data ?? '');
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
  const recentText = session.messages
    .map(m => m.content)
    .join('\n')
    .slice(-retrievalWindowChars);
  const query = recentText + '\n' + userContent;

  const { userId } = session;

  let injected = [];
  if (query.trim().length >= 20) {
    const candidates = await queryMemories(userId, query, maxInjectedMemories);
    log('candidates', candidates.length > 0 ? candidates : '(none)');

    if (candidates.length > 0) {
      const numbered = candidates.map((m, i) => `${i + 1}. ${m}`).join('\n');
      const response = await complete(
        [
          { role: 'system', content: FILTER_SYSTEM },
          { role: 'user', content: `Context:\n${query}\n\nMemories:\n${numbered}` }
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
