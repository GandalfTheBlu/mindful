import { chunkSummarize } from './chunkSummarize.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:webFetch] ${label}`, data ?? '');
}

export async function webFetch({ url, task, keywords }, onProgress = () => {}) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  log('url', url);
  log('request', `GET ${jinaUrl}`);
  if (task) log('task', task);
  if (keywords?.length) log('keywords', keywords.join(', '));

  const t0 = Date.now();
  const res = await fetch(jinaUrl, { headers: { Accept: 'text/plain' } });
  log('response', `${res.status} ${res.statusText} (${Date.now() - t0}ms)`);
  if (!res.ok) throw new Error(`webFetch failed: ${res.status} ${res.statusText}`);

  const raw = await res.text();
  log('raw', `${raw.length} chars received`);

  // Enforce maxChars to prevent enormous pages from producing hundreds of chunks
  const maxChars = config.tools?.webFetch?.maxChars ?? 25000;
  const text = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  if (raw.length > maxChars) log('truncate', `${raw.length} → ${maxChars} chars`);

  const summarizeTask = task ?? 'Summarise the main content of this page.';
  const kws = keywords ?? [];

  const result = await chunkSummarize(text, summarizeTask, kws, onProgress);
  log('summary', `${result.length} chars returned to model`);
  return result;
}
