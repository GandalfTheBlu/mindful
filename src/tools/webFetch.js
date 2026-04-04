import { chunkSummarize } from './chunkSummarize.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:webFetch] ${label}`, data ?? '');
}

export async function webFetch({ url, task, keywords }) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  log('fetch', jinaUrl);
  const res = await fetch(jinaUrl, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`webFetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  log('fetched', `${text.length} chars`);

  const summarizeTask = task ?? 'Summarise the main content of this page.';
  log('summarizing', `${text.length} chars → task: ${summarizeTask}`);
  return await chunkSummarize(text, summarizeTask, keywords ?? []);
}
