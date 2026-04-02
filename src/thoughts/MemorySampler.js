import { listAllMemories } from '../core/vectraStore.js';

// Returns a random sample of stored memories. Randomness provides thematic
// distance from the current conversation — the opposite of targeted retrieval.
export async function sampleDistantMemories(count = 3) {
  const all = await listAllMemories();
  if (all.length === 0) return [];
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
