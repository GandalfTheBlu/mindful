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

export function listSessions() {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { id: s.id, title: s.title || 'New conversation', createdAt: s.createdAt, messageCount: s.messages.length };
      } catch { return null; }
    })
    .filter(Boolean)
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

export function createSession() {
  return {
    id: uuidv4(),
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    messages: []
  };
}
