// --- Identity ---
let currentUserId = localStorage.getItem('mindful_userId') || 'Gandalf';

// --- State ---
let currentSession = null;

// --- DOM ---
const userDisplay = document.getElementById('user-display');
const userDropdown = document.getElementById('user-dropdown');
const sessionList = document.getElementById('session-list');
const messages = document.getElementById('messages');
const inputEl = document.getElementById('input');
const form = document.getElementById('input-form');
const btnSend = document.getElementById('btn-send');
const btnNew = document.getElementById('btn-new');
const btnSave = document.getElementById('btn-save');
const chatTitle = document.getElementById('chat-title');

// --- API helpers ---
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// --- User bar ---
function renderUserDisplay() {
  userDisplay.textContent = currentUserId;
}

async function showUserDropdown() {
  const users = await api('GET', '/api/users');
  userDropdown.innerHTML = '';
  for (const u of users) {
    const li = document.createElement('li');
    li.textContent = u;
    if (u === currentUserId) li.classList.add('active');
    li.addEventListener('mousedown', e => e.preventDefault()); // prevent blur before click
    li.addEventListener('click', () => selectUser(u));
    userDropdown.appendChild(li);
  }
  userDropdown.hidden = users.length === 0;
}

async function selectUser(userId) {
  userDropdown.hidden = true;
  userDisplay.contentEditable = 'false';
  if (userId !== currentUserId) {
    currentUserId = userId;
    localStorage.setItem('mindful_userId', currentUserId);
    renderUserDisplay();
    clearChat();
    await loadSessionList();
  }
}

userDisplay.addEventListener('click', async () => {
  userDisplay.contentEditable = 'true';
  userDisplay.focus();
  const range = document.createRange();
  range.selectNodeContents(userDisplay);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  await showUserDropdown();
});

userDisplay.addEventListener('blur', async () => {
  userDropdown.hidden = true;
  userDisplay.contentEditable = 'false';
  const newId = userDisplay.textContent.trim();
  if (newId && newId !== currentUserId) {
    currentUserId = newId;
    localStorage.setItem('mindful_userId', currentUserId);
    clearChat();
    await loadSessionList();
  } else {
    renderUserDisplay(); // restore if empty
  }
});

userDisplay.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); userDisplay.blur(); }
  if (e.key === 'Escape') { userDisplay.textContent = currentUserId; userDisplay.blur(); }
});

// --- Session list ---
async function loadSessionList() {
  const sessions = await api('GET', `/api/sessions?userId=${encodeURIComponent(currentUserId)}`);
  sessionList.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    if (currentSession?.id === s.id) li.classList.add('active');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title-text';
    titleSpan.textContent = s.title;

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete-session';
    btnDel.textContent = '✕';
    btnDel.title = 'Delete';
    btnDel.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete "${s.title}"?`)) return;
      await api('DELETE', `/api/sessions/${s.id}`);
      if (currentSession?.id === s.id) clearChat();
      loadSessionList();
    });

    li.appendChild(titleSpan);
    li.appendChild(btnDel);
    li.addEventListener('click', () => openSession(s.id));
    sessionList.appendChild(li);
  }
}

// --- Open session ---
async function openSession(id) {
  const session = await api('GET', `/api/sessions/${id}`);
  currentSession = session;
  renderSession(session);
  await loadSessionList();
  setUiEnabled(true);
}

function renderSession(session) {
  messages.innerHTML = '';
  chatTitle.textContent = session.title;

  for (const msg of session.messages) {
    if (msg.isSummary) {
      appendSummary(msg.content);
    } else if (msg.role === 'user') {
      appendUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      appendAssistantMessage(msg.content);
    }
  }
  scrollToBottom();
}

// --- Render helpers ---
function appendSummary(text) {
  const div = document.createElement('div');
  div.className = 'message summary';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  messages.appendChild(div);
  return div;
}

function appendUserMessage(content) {
  const div = document.createElement('div');
  div.className = 'message user';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;
  div.appendChild(bubble);
  messages.appendChild(div);
  return div;
}

function appendAssistantMessage(content) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = renderBold(content);
  div.appendChild(bubble);
  messages.appendChild(div);
  return { div, bubble };
}

// --- Send message ---
form.addEventListener('submit', async e => {
  e.preventDefault();
  const content = inputEl.value.trim();
  if (!content || !currentSession) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  setUiEnabled(false);

  appendUserMessage(content);
  scrollToBottom();

  // Streaming assistant bubble
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  bubble.appendChild(cursor);
  assistantDiv.appendChild(bubble);
  messages.appendChild(assistantDiv);

  const res = await fetch(`/api/sessions/${currentSession.id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  if (!res.ok) {
    const err = await res.json();
    bubble.textContent = `Error: ${err.error}`;
    setUiEnabled(true);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === 'chunk') {
        streamedText += event.content;
        bubble.innerHTML = renderBold(streamedText);
        bubble.appendChild(cursor);
        scrollToBottom();
      } else if (event.type === 'done') {
        cursor.remove();
        setUiEnabled(true);
      } else if (event.type === 'error') {
        cursor.remove();
        bubble.textContent = `Error: ${event.message}`;
        setUiEnabled(true);
      }
    }
  }
});

// --- Save ---
btnSave.addEventListener('click', async () => {
  if (!currentSession) return;
  await api('PUT', `/api/sessions/${currentSession.id}`);
});

// --- New session ---
btnNew.addEventListener('click', async () => {
  const session = await api('POST', '/api/sessions', { userId: currentUserId });
  currentSession = session;
  messages.innerHTML = '';
  chatTitle.textContent = session.title;
  setUiEnabled(true);
  await loadSessionList();
  inputEl.focus();
});

// --- Title editing ---
chatTitle.addEventListener('dblclick', () => {
  if (!currentSession) return;
  chatTitle.contentEditable = 'true';
  chatTitle.focus();
  const range = document.createRange();
  range.selectNodeContents(chatTitle);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
});

chatTitle.addEventListener('blur', async () => {
  chatTitle.contentEditable = 'false';
  if (!currentSession) return;
  const newTitle = chatTitle.textContent.trim();
  if (newTitle && newTitle !== currentSession.title) {
    currentSession.title = newTitle;
    await api('PATCH', `/api/sessions/${currentSession.id}/title`, { title: newTitle });
    loadSessionList();
  }
});

chatTitle.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); chatTitle.blur(); }
  if (e.key === 'Escape') { chatTitle.textContent = currentSession?.title ?? ''; chatTitle.blur(); }
});

// --- Input auto-resize ---
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = inputEl.scrollHeight + 'px';
});

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// --- Markdown rendering ---
function renderBold(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/gs, '<em>$1</em>');
}

// --- Helpers ---
function setUiEnabled(enabled) {
  inputEl.disabled = !enabled;
  btnSend.disabled = !enabled;
  btnSave.disabled = !enabled || !currentSession;
  if (enabled) inputEl.focus();
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function clearChat() {
  currentSession = null;
  messages.innerHTML = '';
  chatTitle.textContent = 'Select or start a conversation';
  setUiEnabled(false);
}

// --- Wipe memory ---
document.getElementById('btn-wipe-memory').addEventListener('click', async () => {
  if (!confirm(`Wipe all memories for "${currentUserId}"? This cannot be undone.`)) return;
  await api('DELETE', `/api/memories?userId=${encodeURIComponent(currentUserId)}`);
});

// --- Memory search ---
const memoryModal = document.getElementById('memory-search-modal');
const memorySearchInput = document.getElementById('memory-search-input');
const memorySearchLimit = document.getElementById('memory-search-limit');
const memorySearchResults = document.getElementById('memory-search-results');

document.getElementById('btn-search-memory').addEventListener('click', () => {
  memoryModal.hidden = false;
  memorySearchInput.focus();
});

document.getElementById('btn-close-search').addEventListener('click', () => {
  memoryModal.hidden = true;
});

memoryModal.addEventListener('click', e => {
  if (e.target === memoryModal) memoryModal.hidden = true;
});

memoryModal.addEventListener('keydown', e => {
  if (e.key === 'Escape') memoryModal.hidden = true;
});

document.getElementById('btn-run-search').addEventListener('click', runMemorySearch);
memorySearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') runMemorySearch();
});

async function runMemorySearch() {
  const query = memorySearchInput.value.trim();
  if (!query) return;

  const limit = Math.min(Math.max(parseInt(memorySearchLimit.value) || 10, 1), 100);
  memorySearchResults.innerHTML = '<div class="memory-search-empty">Searching…</div>';

  const results = await api('POST', '/api/memories/search', { query, limit, userId: currentUserId });

  if (!Array.isArray(results) || results.length === 0) {
    memorySearchResults.innerHTML = '<div class="memory-search-empty">No results.</div>';
    return;
  }

  memorySearchResults.innerHTML = '';
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'memory-result';

    const score = document.createElement('span');
    score.className = 'memory-score';
    score.textContent = `${Math.round(r.score * 100)}%`;

    const text = document.createElement('span');
    text.className = 'memory-text';
    text.textContent = r.text;

    row.appendChild(score);
    row.appendChild(text);
    memorySearchResults.appendChild(row);
  }
}

// --- Init ---
renderUserDisplay();
loadSessionList();
