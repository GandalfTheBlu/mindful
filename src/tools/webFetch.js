import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:webFetch] ${label}`, data ?? '');
}

export async function webFetch({ url }) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  log('fetch', jinaUrl);
  const res = await fetch(jinaUrl, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`webFetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const maxChars = config.tools?.webFetch?.maxChars ?? 12000;
  const truncated = text.slice(0, maxChars);
  log('done', `${truncated.length} chars`);
  return truncated;
}
