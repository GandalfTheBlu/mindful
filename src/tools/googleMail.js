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
      metadataHeaders: ['From', 'To', 'Subject', 'Date']
    });

    const headers = full.data.payload?.headers ?? [];
    const get = name => headers.find(h => h.name === name)?.value ?? '';

    const subject = get('Subject');
    const from = get('From');
    const date = get('Date');
    const snippet = full.data.snippet ?? '';

    if (!includeBody) {
      return `Date: ${date}\nFrom: ${from}\nSubject: ${subject}\nSnippet: ${snippet}`;
    }

    // Extract plain text body
    const body = extractBody(full.data.payload);
    return `Date: ${date}\nFrom: ${from}\nSubject: ${subject}\n\n${body}`;
  }));

  return results.join('\n\n---\n\n');
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
