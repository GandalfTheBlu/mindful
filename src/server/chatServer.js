import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { init as initVectra, wipeMemories } from '../core/vectraStore.js';
import {
  ensureDataDir, listSessions, getSession,
  saveSession, deleteSession, createSession
} from './sessionStore.js';
import { CognitivePipeline } from '../pipeline/CognitivePipeline.js';

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
app.get('/api/sessions', (req, res) => {
  res.json(listSessions());
});

app.post('/api/sessions', (req, res) => {
  const session = createSession();
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

app.delete('/api/memories', async (req, res) => {
  await wipeMemories();
  res.json({ ok: true });
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

  try {
    await pipeline.process(session, content.trim(), chunk => {
      send({ type: 'chunk', content: chunk });
    });

    saveSession(session);
    send({ type: 'done' });

  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
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
