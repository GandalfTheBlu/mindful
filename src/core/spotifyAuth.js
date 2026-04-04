import fs from 'fs';
import http from 'http';
import path from 'path';
import config from '../config.js';

const SCOPES = [
  'user-read-recently-played',
  'user-top-read',
  'user-read-currently-playing'
].join(' ');

function loadCredentials() {
  const file = config.spotify?.credentialsFile;
  if (!file) throw new Error('spotify.credentialsFile not set in config.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadToken() {
  const file = config.spotify?.tokenFile;
  if (!file) return null;
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function saveToken(token) {
  const file = config.spotify?.tokenFile;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(token), 'utf8');
}

export function getTokenStatus() {
  if (!config.spotify?.tokenFile) return { valid: false };
  const token = loadToken();
  if (!token?.access_token) return { valid: false };
  return { valid: true };
}

export async function getAccessToken() {
  const token = loadToken();
  if (!token) throw new Error('Spotify not authenticated — use Re-authenticate in the app');

  // Refresh if expired or within 60s of expiry
  if (token.expires_at && Date.now() >= token.expires_at - 60000) {
    const creds = loadCredentials();
    const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
    });
    if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
    const refreshed = await res.json();
    const newToken = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? token.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000
    };
    saveToken(newToken);
    return newToken.access_token;
  }

  return token.access_token;
}

export function startReauthFlow() {
  const creds = loadCredentials();
  const redirectUri = config.spotify?.redirectUri ?? 'http://127.0.0.1:3001/callback';
  const callbackPort = parseInt(new URL(redirectUri).port) || 3001;

  const params = new URLSearchParams({
    client_id: creds.client_id,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES
  });
  const url = `https://accounts.spotify.com/authorize?${params}`;

  const promise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, redirectUri);
      const code = reqUrl.searchParams.get('code');
      if (!code) { res.end('No code received.'); return; }
      res.end('<h2>Spotify auth complete — you can close this tab.</h2>');
      server.close();
      try {
        const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
        });
        if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
        const data = await tokenRes.json();
        saveToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
        resolve();
      } catch (err) { reject(err); }
    });
    server.listen(callbackPort, '127.0.0.1', () => {});
    server.on('error', reject);
  });

  return { url, promise };
}
