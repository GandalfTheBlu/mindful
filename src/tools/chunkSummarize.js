import { complete } from '../llm.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [chunkSummarize] ${label}`, data ?? '');
}

const CHUNK_SYSTEM = `/no_think
Summarise only the parts of the following text that are relevant to the given task. Be concise. If nothing is relevant, output NOTHING.`;

const MERGE_SYSTEM = `/no_think
Combine these partial summaries into a single coherent answer for the given task. Be concise.`;

// Splits text into overlapping chunks, optionally filters by keywords,
// summarises each matching chunk with a task-relevance lens, then merges.
// keywords: string[] — if provided, only chunks containing at least one keyword are summarised.
// onProgress: (label: string) => void — called before each chunk summarisation step.
export async function chunkSummarize(text, task, keywords = [], onProgress = () => {}) {
  const { chunkSize = 3000, overlapSize = 200 } = config.tools?.readFile ?? {};

  const allChunks = [];
  for (let i = 0; i < text.length; i += chunkSize - overlapSize) {
    allChunks.push(text.slice(i, i + chunkSize));
    if (i + chunkSize >= text.length) break;
  }

  if (allChunks.length === 0) return 'Content is empty.';

  const chunks = keywords.length > 0
    ? allChunks.filter(c => keywords.some(kw => c.toLowerCase().includes(kw.toLowerCase())))
    : allChunks;

  log(
    'chunks',
    keywords.length > 0
      ? `${chunks.length}/${allChunks.length} after keyword filter`
      : allChunks.length
  );

  const maxChunks = config.tools?.webFetch?.maxChunks ?? 8;
  if (chunks.length > maxChunks) {
    log('abort', `${chunks.length} chunks exceeds limit of ${maxChunks} — keywords too broad`);
    return `TOO_MANY_CHUNKS: ${chunks.length} matching chunks (limit ${maxChunks}). Use more specific keywords to narrow the search.`;
  }

  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(`Summarizing chunk ${i + 1}/${chunks.length}...`);
    log(`chunk ${i + 1}/${chunks.length}`, '');
    const summary = await complete(
      [
        { role: 'system', content: CHUNK_SYSTEM },
        { role: 'user', content: `Task: ${task}\n\nText:\n${chunks[i]}` }
      ],
      { max_tokens: 300 }
    );
    if (summary && !summary.includes('NOTHING')) summaries.push(summary.trim());
  }

  if (summaries.length === 0) return 'Nothing relevant found.';
  if (summaries.length === 1) return summaries[0];

  log('merge', `${summaries.length} summaries`);
  onProgress(`Merging ${summaries.length} summaries...`);
  return await complete(
    [
      { role: 'system', content: MERGE_SYSTEM },
      { role: 'user', content: `Task: ${task}\n\n${summaries.join('\n\n---\n\n')}` }
    ],
    { max_tokens: 500 }
  );
}
