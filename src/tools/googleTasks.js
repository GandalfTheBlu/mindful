import { google } from 'googleapis';
import { getAuthClient } from '../core/googleAuth.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:tasks] ${label}`, data ?? '');
}

function formatDue(due) {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const diffDays = Math.round((d - now) / (1000 * 60 * 60 * 24));
  const dateStr = d.toLocaleDateString('en-SE', { month: 'short', day: 'numeric' });
  if (diffDays < 0) return `${dateStr} (overdue by ${Math.abs(diffDays)}d)`;
  if (diffDays === 0) return `${dateStr} (today)`;
  if (diffDays === 1) return `${dateStr} (tomorrow)`;
  return dateStr;
}

export async function listTasks({ maxResults = 50 } = {}) {
  const auth = getAuthClient();
  const tasks = google.tasks({ version: 'v1', auth });

  log('fetching task lists');
  const listsRes = await tasks.tasklists.list({ maxResults: 10 });
  const lists = listsRes.data.items ?? [];

  if (lists.length === 0) return 'No task lists found.';

  const allTasks = [];

  for (const list of lists.slice(0, 5)) {
    const res = await tasks.tasks.list({
      tasklist: list.id,
      showCompleted: false,
      showHidden: false,
      maxResults: Math.ceil(maxResults / lists.length)
    });
    const items = (res.data.items ?? []).filter(t => t.status !== 'completed');
    for (const t of items) {
      allTasks.push({ id: t.id, title: t.title, notes: t.notes, due: t.due, listId: list.id, listName: list.title });
    }
  }

  log('results', `${allTasks.length} tasks`);

  if (allTasks.length === 0) return 'No pending tasks.';

  // Sort: overdue first, then by due date, then undated
  const now = Date.now();
  allTasks.sort((a, b) => {
    const da = a.due ? new Date(a.due).getTime() : Infinity;
    const db = b.due ? new Date(b.due).getTime() : Infinity;
    return da - db;
  });

  return allTasks.map(t => {
    const due = t.due ? ` [due: ${formatDue(t.due)}]` : '';
    const notes = t.notes ? ` — ${t.notes.slice(0, 80)}` : '';
    return `• ${t.title}${due}${notes}`;
  }).join('\n');
}

export async function createTask({ title, notes, due, taskList = '@default' } = {}) {
  if (!title?.trim()) throw new Error('title is required');
  const auth = getAuthClient();
  const tasks = google.tasks({ version: 'v1', auth });

  const body = { title: title.trim() };
  if (notes) body.notes = notes;
  if (due) body.due = new Date(due).toISOString();

  log('creating', title);
  const res = await tasks.tasks.insert({ tasklist: taskList, requestBody: body });
  return `Task created: "${res.data.title}"${due ? ` (due ${formatDue(res.data.due)})` : ''}`;
}

export async function completeTask({ taskId, taskList = '@default' } = {}) {
  if (!taskId) throw new Error('taskId is required');
  const auth = getAuthClient();
  const tasks = google.tasks({ version: 'v1', auth });

  log('completing', taskId);
  const res = await tasks.tasks.patch({
    tasklist: taskList,
    task: taskId,
    requestBody: { status: 'completed' }
  });
  return `Task completed: "${res.data.title}"`;
}
