// --- Log buffer (must be first) ---
const logBuffer = [];
const _origLog = console.log;
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logBuffer.push({ t: Date.now(), line });
  if (logBuffer.length > 500) logBuffer.shift();
  _origLog(...args);
};

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { init as initVectra, wipeMemories, searchMemories } from '../core/vectraStore.js';
import { wipeUserModel, getUserModel } from '../core/userModel.js';
import { getTokenStatus, startReauthFlow } from '../core/googleAuth.js';
import { getTokenStatus as getSpotifyTokenStatus, startReauthFlow as startSpotifyReauthFlow } from '../core/spotifyAuth.js';
import { synthesize, isTTSConfigured } from '../tts.js';
import {
  ensureDataDir, listSessions, listUsers, getSession,
  saveSession, deleteSession, deleteUserSessions, createSession
} from './sessionStore.js';
import { CognitivePipeline } from '../pipeline/CognitivePipeline.js';
import { generateOpener } from '../pipeline/opener.js';
import { runBriefing } from '../pipeline/briefing.js';

const app = express();
const PORT = 3000;
const __dir = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dir, '..', 'client')));

const pipeline = new CognitivePipeline();

// --- In-memory session cache ---
const sessionCache = new Map();

function loadSession(id) {
  if (sessionCache.has(id)) return sessionCache.get(id);
  const session = getSession(id);
  if (session) sessionCache.set(id, session);
  return session;
}

// --- Session routes ---
app.get('/api/users', (req, res) => {
  res.json(listUsers());
});

app.get('/api/sessions', (req, res) => {
  const userId = req.query.userId || null;
  res.json(listSessions(userId));
});

app.post('/api/sessions', (req, res) => {
  const userId = req.body?.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const session = createSession(userId);
  saveSession(session);
  sessionCache.set(session.id, session);
  res.json(session);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

app.put('/api/sessions/:id', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  saveSession(session);
  res.json({ ok: true });
});

app.patch('/api/sessions/:id/title', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  session.title = req.body.title;
  saveSession(session);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req, res) => {
  sessionCache.delete(req.params.id);
  deleteSession(req.params.id);
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json(logBuffer.filter(e => e.t > since));
});

app.delete('/api/sessions', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const count = deleteUserSessions(userId);
  res.json({ deleted: count });
});

app.delete('/api/memories', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  await wipeMemories(userId);
  wipeUserModel(userId);
  res.json({ ok: true });
});

app.get('/api/usermodel', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const model = getUserModel(userId);
  res.json({ model: model ?? null });
});

app.post('/api/memories/search', async (req, res) => {
  const { query, limit, userId, type } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!query?.trim()) return res.status(400).json({ error: 'Empty query' });
  const topK = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
  const validTypes = new Set(['semantic', 'episodic', 'procedural', 'goal']);
  const typeFilter = validTypes.has(type) ? type : null;
  const results = await searchMemories(userId, query.trim(), topK, typeFilter);
  res.json(results);
});

// --- TTS route ---
app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });
  if (!isTTSConfigured()) return res.status(503).json({ error: 'TTS not configured' });
  try {
    const wav = await synthesize(text);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', wav.length);
    res.end(wav);
  } catch (err) {
    console.error('[tts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Google auth routes ---
let pendingReauth = null;

app.get('/api/google/auth-status', (req, res) => {
  res.json(getTokenStatus());
});

app.post('/api/google/reauth', (req, res) => {
  if (pendingReauth) return res.json({ url: pendingReauth.url });
  const { url, promise } = startReauthFlow();
  pendingReauth = { url, promise };
  promise.finally(() => { pendingReauth = null; });
  res.json({ url });
});

app.get('/api/google/reauth/wait', (req, res) => {
  if (!pendingReauth) return res.json({ done: true });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  pendingReauth.promise
    .then(() => { send({ type: 'done' }); res.end(); })
    .catch(err => { send({ type: 'error', message: err.message }); res.end(); });
});

// --- Spotify auth routes ---
let pendingSpotifyReauth = null;

app.get('/api/spotify/auth-status', (req, res) => {
  res.json(getSpotifyTokenStatus());
});

app.post('/api/spotify/reauth', (req, res) => {
  if (pendingSpotifyReauth) return res.json({ url: pendingSpotifyReauth.url });
  const { url, promise } = startSpotifyReauthFlow();
  pendingSpotifyReauth = { url, promise };
  promise.finally(() => { pendingSpotifyReauth = null; });
  res.json({ url });
});

app.get('/api/spotify/reauth/wait', (req, res) => {
  if (!pendingSpotifyReauth) return res.json({ done: true });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  pendingSpotifyReauth.promise
    .then(() => { send({ type: 'done' }); res.end(); })
    .catch(err => { send({ type: 'error', message: err.message }); res.end(); });
});

// --- Session opener route (SSE) ---
app.post('/api/sessions/:id/open', async (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  // Only generate an opener for a brand-new session with no messages
  if (session.messages.length > 0) {
    return res.status(200).json({ skipped: true });
  }

  // Compute days since the previous session for this user
  const allSessions = listSessions(session.userId);
  const previousSession = allSessions.find(s => s.id !== session.id);
  let daysSinceLastSession = null;
  if (previousSession?.createdAt) {
    daysSinceLastSession = (Date.now() - new Date(previousSession.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    const content = await generateOpener(session, daysSinceLastSession, chunk => {
      send({ type: 'chunk', content: chunk });
    });

    if (content) {
      session.messages.push({ role: 'assistant', content });
      saveSession(session);
    }

    send({ type: 'done', generated: !!content });
  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// --- Briefing route (SSE) ---
app.post('/api/sessions/:id/brief', async (req, res) => {
  if (busy) return res.status(409).json({ error: 'Busy' });

  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

  busy = true;
  try {
    const content = await runBriefing(session, chunk => send({ type: 'chunk', content: chunk }));
    if (content) {
      session.messages.push({ role: 'assistant', content });
      saveSession(session);
    }
    send({ type: 'done', generated: !!content });
  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
  } finally {
    busy = false;
    res.end();
  }
});

// --- Chat route (SSE) ---
let busy = false;

app.post('/api/sessions/:id/chat', async (req, res) => {
  if (busy) return res.status(409).json({ error: 'Busy' });

  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  busy = true;
  let streamDone = false;

  try {
    await pipeline.process(
      session,
      content.trim(),
      chunk => send({ type: 'chunk', content: chunk }),
      label => send({ type: 'status', label }),
      () => { streamDone = true; saveSession(session); send({ type: 'done' }); }
    );

  } catch (err) {
    console.error(err);
    if (!streamDone) send({ type: 'error', message: err.message });
    else console.error('[chat] post-stream error (already sent done):', err.message);
  } finally {
    busy = false;
    res.end();
  }
});

// --- Boot ---
ensureDataDir();
initVectra().then(() => {
  app.listen(PORT, () => {
    console.log(`mindful running at http://localhost:${PORT}`);
  });
});
