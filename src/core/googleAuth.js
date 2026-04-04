import fs from 'fs';
import http from 'http';
import path from 'path';
import { google } from 'googleapis';
import config from '../config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly'
];

function loadCredentials() {
  const file = config.google?.credentialsFile;
  if (!file) throw new Error('google.credentialsFile not set in config.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.installed ?? raw.web;
}

function loadToken() {
  const file = config.google?.tokenFile;
  if (!file) return null;
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function saveToken(tokens) {
  const file = config.google?.tokenFile;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens), 'utf8');
}

// Returns { valid: bool, expiresAt: ms|null }
// The refresh token expires after refresh_token_expires_in seconds from issue.
// Issue time is approximated as expiry_date - 3600000 (access token TTL is 1h).
export function getTokenStatus() {
  if (!config.google?.tokenFile) return { valid: false, expiresAt: null };
  const token = loadToken();
  if (!token) return { valid: false, expiresAt: null };

  if (token.refresh_token_expires_in && token.expiry_date) {
    const issuedAt = token.expiry_date - 3600 * 1000;
    const refreshExpiresAt = issuedAt + token.refresh_token_expires_in * 1000;
    if (Date.now() >= refreshExpiresAt) return { valid: false, expiresAt: refreshExpiresAt };
    return { valid: true, expiresAt: refreshExpiresAt };
  }

  // No refresh_token_expires_in — assume valid if token file exists
  return { valid: true, expiresAt: null };
}

export function getAuthClient() {
  const creds = loadCredentials();
  const client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:4242'
  );
  const token = loadToken();
  if (token) client.setCredentials(token);
  return client;
}

// Starts the OAuth flow: returns the auth URL immediately and a promise that
// resolves when the redirect is caught and the token is saved.
export function startReauthFlow() {
  const creds = loadCredentials();
  const client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:4242'
  );
  const url = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  const promise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const code = new URL(req.url, 'http://localhost:4242').searchParams.get('code');
      if (!code) { res.end('No code received.'); return; }
      res.end('<h2>Auth complete — you can close this tab.</h2>');
      server.close();
      try {
        const { tokens } = await client.getToken(code);
        saveToken(tokens);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    server.listen(4242, () => {});
    server.on('error', reject);
  });

  return { url, promise };
}

// One-time interactive auth flow — run via auth.js script
export async function runAuthFlow() {
  const { url, promise } = startReauthFlow();
  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log('\nWaiting for Google to redirect...\n');
  await promise;
  console.log(`Token saved to ${config.google?.tokenFile}`);
}
