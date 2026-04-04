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
  if (!file) throw new Error('google.tokenFile not set in config.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveToken(token) {
  const file = config.google?.tokenFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(token), 'utf8');
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

// One-time interactive auth flow — run via auth.js script
export async function runAuthFlow() {
  const creds = loadCredentials();
  const client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:4242'
  );

  const url = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  console.log('\nOpen this URL in your browser:\n');
  console.log(url);
  console.log('\nWaiting for Google to redirect...\n');

  const code = await waitForCode(4242);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const tokenFile = config.google?.tokenFile;
  const dir = tokenFile.replace(/[^/\\]+$/, '');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens), 'utf8');
  console.log(`Token saved to ${tokenFile}`);
  return client;
}

function waitForCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const code = new URL(req.url, `http://localhost:${port}`).searchParams.get('code');
      if (!code) { res.end('No code received.'); return; }
      res.end('<h2>Auth complete — you can close this tab.</h2>');
      server.close();
      resolve(code);
    });
    server.listen(port, () => {});
    server.on('error', reject);
  });
}
