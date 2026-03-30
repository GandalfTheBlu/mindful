import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { init as initVectra, addMemory, wipeMemories } from '../core/vectraStore.js';
import { processMessage } from '../core/contextManager.js';
import { extractMemories } from '../core/memoryExtractor.js';
import { complete, stream } from '../llm.js';
import {
  ensureDataDir, listSessions, getSession,
  saveSession, deleteSession, createSession
} from './sessionStore.js';

const app = express();
const PORT = 3000;
const __dir = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dir, '..', 'client')));

const SYSTEM_PROMPT = `You are an AI having a casual conversation. Be direct and natural — no bullet points, no formal structure, no assistant-speak. Do not pretend to be human. Do not claim to have personal experiences, feelings, hobbies, or opinions you don't actually have. If something doesn't apply to you as an AI, just say so plainly. Stay honest, stay casual.`;

function log(label, data) {
  console.log(`[${new Date().toISOString()}] ${label}`, data ?? '');
}

// --- State machine ---
const State = { IDLE: 'idle', RETRIEVING: 'retrieving', STREAMING: 'streaming', EXTRACTING: 'extracting' };
let state = State.IDLE;

// --- In-memory session cache ---
// Sessions are loaded from disk on first access and kept in memory.
// The Save button is the only operation that writes back to disk.
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
app.post('/api/sessions/:id/chat', async (req, res) => {
  if (state !== State.IDLE) {
    return res.status(409).json({ error: 'Busy', state });
  }

  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Empty message' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  const isFirstMessage = session.messages.length === 0;

  try {
    // --- RETRIEVING ---
    state = State.RETRIEVING;
    const { llmMessages, userMsg } = await processMessage(session, content.trim());

    // Generate title on first message
    if (isFirstMessage) {
      const title = await complete(
        [
          { role: 'system', content: 'Generate a short title (3-6 words) for a conversation starting with this message. Output only the title, no quotes.' },
          { role: 'user', content: content.trim() }
        ],
        { max_tokens: 20 }
      );
      session.title = title.trim();
      send({ type: 'title', title: session.title });
    }

    // --- STREAMING ---
    state = State.STREAMING;
    let assistantContent = '';

    await stream(
      [{ role: 'system', content: SYSTEM_PROMPT }, ...llmMessages],
      chunk => {
        assistantContent += chunk;
        send({ type: 'chunk', content: chunk });
      }
    );

    const assistantMsg = { role: 'assistant', content: assistantContent };
    session.messages.push(assistantMsg);

    send({ type: 'assistant', message: assistantMsg });

    // --- EXTRACTING ---
    state = State.EXTRACTING;
    send({ type: 'extracting' });

    log('memory:extract:input', content.trim());
    const extracted = await extractMemories(content.trim(), session.messages.slice(0, -2));
    log('memory:extract:result', extracted.length > 0 ? extracted : '(nothing)');

    for (const fact of extracted) {
      await addMemory(fact);
      log('memory:stored', fact);
    }
    userMsg.extractedMemories = extracted;

    send({ type: 'done', userMsg, extracted });

  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
  } finally {
    state = State.IDLE;
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
