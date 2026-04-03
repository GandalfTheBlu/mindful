import { complete } from '../llm.js';
import { queryMemories, listAllMemories } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [retrieve] ${label}`, data ?? '');
}

const FILTER_SYSTEM = `/no_think
You are given a conversation context and numbered candidate memories. Output only the numbers of memories that would meaningfully change or improve a response to this specific conversation — not memories that merely share a topic. When in doubt, exclude. Output comma-separated numbers only. If none qualify, output nothing.`;

export async function retrieve(session, userContent) {
  const { retrievalWindowChars, maxInjectedMemories } = config.memory;

  // Build deduplication set from memories already in context
  const alreadyInContext = new Set(
    session.messages.flatMap(m => [
      ...(m.injectedMemories ?? []),
      ...(m.extractedMemories ?? [])
    ])
  );

  // --- Targeted retrieval ---
  const recentText = session.messages
    .map(m => m.content)
    .join('\n')
    .slice(-retrievalWindowChars);
  const query = recentText + '\n' + userContent;

  let injected = [];
  if (query.trim().length >= 20) {
    const candidates = await queryMemories(query, maxInjectedMemories);
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

  // --- Random sampling (thematic distance) ---
  const all = await listAllMemories();
  const sampled = all.length > 0
    ? [...all].sort(() => Math.random() - 0.5).slice(0, 3)
    : [];

  log('sampled', sampled.length > 0 ? sampled : '(none)');

  return { injected, sampled };
}
