import { google } from 'googleapis';
import { getAuthClient } from '../core/googleAuth.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:mail] ${label}`, data ?? '');
}

export async function searchMail({ query, maxResults = 10, includeBody = false }) {
  const auth = getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  log('query', `"${query}", max ${maxResults}`);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults
  });

  const messages = listRes.data.messages ?? [];
  log('results', `${messages.length} messages`);

  if (messages.length === 0) return 'No messages found.';

  const results = await Promise.all(messages.map(async msg => {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: includeBody ? 'full' : 'metadata',
      metadataHeaders: ['From', 'Subject']
    });

    const headers = full.data.payload?.headers ?? [];
    const get = name => headers.find(h => h.name === name)?.value ?? '';

    const subject = get('Subject');
    const from = get('From');
    const snippet = full.data.snippet ?? '';
    const internalDate = parseInt(full.data.internalDate ?? '0');
    const dateStr = internalDate
      ? new Date(internalDate).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : '(unknown date)';

    if (!includeBody) {
      return { internalDate, text: `Date: ${dateStr}\nFrom: ${from}\nSubject: ${subject}\nSnippet: ${snippet}` };
    }

    const body = extractBody(full.data.payload);
    return { internalDate, text: `Date: ${dateStr}\nFrom: ${from}\nSubject: ${subject}\n\n${body}` };
  }));

  // Sort newest first using Gmail's authoritative arrival timestamp
  results.sort((a, b) => b.internalDate - a.internalDate);

  return results.map(r => r.text).join('\n\n---\n\n');
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  return '';
}
