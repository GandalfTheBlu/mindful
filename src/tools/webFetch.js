import { chunkSummarize } from './chunkSummarize.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:webFetch] ${label}`, data ?? '');
}

export async function webFetch({ url, task, keywords }) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  log('url', url);
  log('request', `GET ${jinaUrl}`);
  if (task) log('task', task);
  if (keywords?.length) log('keywords', keywords.join(', '));

  const t0 = Date.now();
  const res = await fetch(jinaUrl, { headers: { Accept: 'text/plain' } });
  log('response', `${res.status} ${res.statusText} (${Date.now() - t0}ms)`);
  if (!res.ok) throw new Error(`webFetch failed: ${res.status} ${res.statusText}`);

  const text = await res.text();
  log('raw', `${text.length} chars received`);

  const summarizeTask = task ?? 'Summarise the main content of this page.';
  const kws = keywords ?? [];
  if (kws.length > 0) {
    const { chunkSize = 3000, overlapSize = 200 } = {};
    const totalChunks = Math.ceil(text.length / (chunkSize - overlapSize));
    log('filter', `keyword filter active — scanning ~${totalChunks} chunks for: ${kws.join(', ')}`);
  }

  const result = await chunkSummarize(text, summarizeTask, kws);
  log('summary', `${result.length} chars returned to model`);
  return result;
}
