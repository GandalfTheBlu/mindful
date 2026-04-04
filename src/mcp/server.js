import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = 'http://localhost:3000';

// --- HTTP helpers ---

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  return res.json();
}

// Consumes an SSE chat stream and returns the full assembled response text.
async function streamChat(sessionId, content) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'chunk') text += event.content;
      if (event.type === 'error') throw new Error(event.message);
    }
  }

  return text;
}

// --- Server ---

const server = new McpServer({
  name: 'mindful',
  version: '0.1.0'
});

server.tool(
  'create_session',
  'Create a new conversation session.',
  { userId: z.string().describe('User identity (e.g. "claude", "Gandalf")') },
  async ({ userId }) => {
    const session = await post('/api/sessions', { userId });
    if (session.error) throw new Error(session.error);
    return { content: [{ type: 'text', text: JSON.stringify(session) }] };
  }
);

server.tool(
  'chat',
  'Send a message in a session and get the full response.',
  {
    sessionId: z.string().describe('Session ID'),
    content: z.string().describe('Message to send')
  },
  async ({ sessionId, content }) => {
    const response = await streamChat(sessionId, content);
    return { content: [{ type: 'text', text: response }] };
  }
);

server.tool(
  'get_logs',
  'Fetch server log lines, optionally only those after a given timestamp.',
  { since: z.number().optional().describe('Unix ms timestamp — only return logs after this') },
  async ({ since }) => {
    const path = since ? `/api/logs?since=${since}` : '/api/logs';
    const logs = await get(path);
    const text = logs.map(e => `[${new Date(e.t).toISOString()}] ${e.line}`).join('\n') || '(no logs)';
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'list_sessions',
  'List all sessions.',
  {},
  async () => {
    const sessions = await get('/api/sessions');
    return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
  }
);

server.tool(
  'get_session',
  'Get a session including its full message history.',
  { sessionId: z.string().describe('Session ID') },
  async ({ sessionId }) => {
    const session = await get(`/api/sessions/${sessionId}`);
    if (session.error) throw new Error(session.error);
    return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
  }
);

server.tool(
  'search_memories',
  'Search stored memories by similarity to a query string.',
  {
    userId: z.string().describe('User whose memories to search'),
    query: z.string().describe('Search query'),
    limit: z.number().min(1).max(100).optional().describe('Max results (default 10)')
  },
  async ({ userId, query, limit }) => {
    const results = await post('/api/memories/search', { userId, query, limit });
    if (results.error) throw new Error(results.error);
    const text = results.map(r => `${Math.round(r.score * 100)}%  ${r.text}`).join('\n') || '(no results)';
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'wipe_memories',
  'Delete all stored memories for a user.',
  { userId: z.string().describe('User whose memories to wipe') },
  async ({ userId }) => {
    const result = await del(`/api/memories?userId=${encodeURIComponent(userId)}`);
    if (result.error) throw new Error(result.error);
    return { content: [{ type: 'text', text: 'Memories wiped.' }] };
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
