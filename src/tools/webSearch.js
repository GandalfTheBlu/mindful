import fs from 'fs';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:webSearch] ${label}`, data ?? '');
}

export async function webSearch({ query }) {
  const maxResults = config.tools?.webSearch?.maxResults ?? 5;
  const keyFile = config.tools?.webSearch?.jinaApiKeyFile;
  if (!keyFile) throw new Error('webSearch requires tools.webSearch.jinaApiKeyFile to be set in config.json');
  let apiKey;
  try {
    apiKey = fs.readFileSync(keyFile, 'utf8').trim();
  } catch {
    throw new Error(`webSearch: could not read API key from ${keyFile}`);
  }
  if (!apiKey) throw new Error(`webSearch: API key file ${keyFile} is empty`);

  const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
  log('query', query);
  log('request', `GET ${url} (maxResults: ${maxResults})`);

  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      Authorization: `Bearer ${apiKey}`,
      'X-With-Links-Summary': String(maxResults)
    }
  });
  log('response', `${res.status} ${res.statusText} (${Date.now() - t0}ms)`);
  if (!res.ok) throw new Error(`webSearch failed: ${res.status} ${res.statusText}`);

  const text = await res.text();
  log('raw', `${text.length} chars received`);

  // Parse into compact result list: title, URL, short description
  const results = [];
  const blocks = text.split(/\n(?=\[\d+\] Title:)/);
  for (const block of blocks) {
    const title = block.match(/Title:\s*(.+)/)?.[1]?.trim();
    const url = block.match(/URL Source:\s*(.+)/)?.[1]?.trim();
    const desc = block.match(/Description:\s*([\s\S]+)/)?.[1]?.trim().slice(0, 200);
    if (title && url) results.push({ title, url, desc: desc || '' });
  }

  if (results.length === 0) {
    log('parse', 'no structured results found, returning raw (truncated)');
    return text.slice(0, 2000);
  }

  log('results', `${results.length} parsed:`);
  results.forEach((r, i) => log(`  [${i + 1}]`, `${r.title} — ${r.url}`));

  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.desc}`)
    .join('\n\n');
}
