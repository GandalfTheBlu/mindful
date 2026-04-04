import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';

const dir = config.dataDir;

function sessionPath(id) {
  return path.join(dir, `${id}.json`);
}

export function ensureDataDir() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function listSessions(userId = null) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { id: s.id, userId: s.userId, title: s.title || 'New conversation', createdAt: s.createdAt, messageCount: s.messages.length };
      } catch { return null; }
    })
    .filter(Boolean)
    .filter(s => !userId || s.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getSession(id) {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveSession(session) {
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8');
}

export function deleteSession(id) {
  const p = sessionPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function deleteUserSessions(userId) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  let count = 0;
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s.userId === userId) {
        fs.unlinkSync(path.join(dir, f));
        count++;
      }
    } catch { /* skip */ }
  }
  return count;
}

export function listUsers() {
  return [...new Set(
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).userId; }
        catch { return null; }
      })
      .filter(Boolean)
  )].sort();
}

export function createSession(userId) {
  return {
    id: uuidv4(),
    userId,
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    messages: []
  };
}
