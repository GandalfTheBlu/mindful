import { complete } from '../llm.js';
import { queryMemories } from './vectraStore.js';
import config from '../config.js';

const SYSTEM = `/no_think
You are given a conversation context and numbered candidate memories. Output only the numbers of memories that are relevant to the context, comma-separated. If none are relevant, output nothing.`;

function log(label, data) {
  console.log(`[${new Date().toISOString()}] ${label}`, data ?? '');
}

export async function retrieveMemories(queryText) {
  const { maxInjectedMemories, maxTokens } = config.memory;

  const candidates = await queryMemories(queryText, maxInjectedMemories);
  log('memory:retrieve:candidates', candidates.length > 0 ? candidates : '(none)');
  if (candidates.length === 0) return [];

  const numbered = candidates.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const response = await complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Context:\n${queryText}\n\nMemories:\n${numbered}` }
    ],
    { max_tokens: maxTokens }
  );

  log('memory:retrieve:filter-response', response.trim() || '(empty)');

  const indices = (response.match(/\d+/g) ?? [])
    .map(n => parseInt(n) - 1)
    .filter(i => i >= 0 && i < candidates.length);

  const kept = indices.map(i => candidates[i]);
  log('memory:retrieve:passed-filter', kept.length > 0 ? kept : '(none)');
  return kept;
}
