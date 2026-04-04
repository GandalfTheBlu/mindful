import { complete } from '../llm.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [chunkSummarize] ${label}`, data ?? '');
}

const CHUNK_SYSTEM = `/no_think
Summarise only the parts of the following text that are relevant to the given task. Be concise. If nothing is relevant, output NOTHING.`;

const MERGE_SYSTEM = `/no_think
Combine these partial summaries into a single coherent answer for the given task. Be concise.`;

// Splits text into overlapping chunks, summarises each with a task-relevance lens,
// then merges into a final answer. Returns a string.
export async function chunkSummarize(text, task) {
  const { chunkSize = 3000, overlapSize = 200 } = config.tools?.readFile ?? {};

  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize - overlapSize) {
    chunks.push(text.slice(i, i + chunkSize));
    if (i + chunkSize >= text.length) break;
  }

  if (chunks.length === 0) return 'Content is empty.';
  log('chunks', chunks.length);

  const summaries = [];
  for (const chunk of chunks) {
    const summary = await complete(
      [
        { role: 'system', content: CHUNK_SYSTEM },
        { role: 'user', content: `Task: ${task}\n\nText:\n${chunk}` }
      ],
      { max_tokens: 300 }
    );
    if (summary && !summary.includes('NOTHING')) summaries.push(summary.trim());
  }

  if (summaries.length === 0) return 'Nothing relevant found.';
  if (summaries.length === 1) return summaries[0];

  log('merge', `${summaries.length} summaries`);
  return await complete(
    [
      { role: 'system', content: MERGE_SYSTEM },
      { role: 'user', content: `Task: ${task}\n\n${summaries.join('\n\n---\n\n')}` }
    ],
    { max_tokens: 500 }
  );
}
