// --- State ---
let currentSession = null;

// --- DOM ---
const sessionList = document.getElementById('session-list');
const messages = document.getElementById('messages');
const inputEl = document.getElementById('input');
const form = document.getElementById('input-form');
const btnSend = document.getElementById('btn-send');
const btnNew = document.getElementById('btn-new');
const btnSave = document.getElementById('btn-save');
const chatTitle = document.getElementById('chat-title');

// Insert status bar between messages and input-form
const statusEl = document.createElement('div');
statusEl.id = 'status';
form.parentElement.insertBefore(statusEl, form);

// --- API helpers ---
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// --- Session list ---
async function loadSessionList() {
  const sessions = await api('GET', '/api/sessions');
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
      appendUserMessage(msg.content, msg.injectedMemories ?? [], msg.extractedMemories ?? []);
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

function appendUserMessage(content, injected = [], extracted = []) {
  const div = document.createElement('div');
  div.className = 'message user';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;
  div.appendChild(bubble);

  if (injected.length > 0 || extracted.length > 0) {
    div.appendChild(buildMemorySection(injected, extracted));
  }

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

function buildMemorySection(injected, extracted) {
  const section = document.createElement('div');
  section.className = 'memory-section';

  const total = injected.length + extracted.length;
  const toggle = document.createElement('button');
  toggle.className = 'memory-toggle';
  toggle.textContent = `▸ ${total} memor${total === 1 ? 'y' : 'ies'}`;

  const list = document.createElement('div');
  list.className = 'memory-list';
  list.style.display = 'none';

  for (const m of injected) {
    const pill = document.createElement('div');
    pill.className = 'memory-pill injected';
    pill.textContent = `↓ ${m}`;
    list.appendChild(pill);
  }
  for (const m of extracted) {
    const pill = document.createElement('div');
    pill.className = 'memory-pill extracted';
    pill.textContent = `↑ ${m}`;
    list.appendChild(pill);
  }

  toggle.addEventListener('click', () => {
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'flex';
    toggle.textContent = `${open ? '▸' : '▾'} ${total} memor${total === 1 ? 'y' : 'ies'}`;
  });

  section.appendChild(toggle);
  section.appendChild(list);
  return section;
}

// --- Send message ---
form.addEventListener('submit', async e => {
  e.preventDefault();
  const content = inputEl.value.trim();
  if (!content || !currentSession) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  setUiEnabled(false);
  setStatus('Retrieving memories…');

  // Optimistically render user bubble (no memories yet)
  const userDiv = appendUserMessage(content);
  scrollToBottom();

  // Create streaming assistant bubble
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
    setStatus(`Error: ${err.error}`);
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
        setStatus('Generating…');
      } else if (event.type === 'title') {
        currentSession.title = event.title;
        chatTitle.textContent = event.title;
        loadSessionList();
      } else if (event.type === 'extracting') {
        cursor.remove();
        setStatus('Storing memories…');
      } else if (event.type === 'done') {
        // Update user message with memory data
        currentSession.messages = currentSession.messages ?? [];
        const injected = event.userMsg.injectedMemories ?? [];
        const extracted = event.extracted ?? [];

        if (injected.length > 0 || extracted.length > 0) {
          userDiv.appendChild(buildMemorySection(injected, extracted));
        }

        setStatus('');
        setUiEnabled(true);
      } else if (event.type === 'error') {
        cursor.remove();
        bubble.textContent = `Error: ${event.message}`;
        setStatus('');
        setUiEnabled(true);
      }
    }
  }
});

// --- Save ---
btnSave.addEventListener('click', async () => {
  if (!currentSession) return;
  await api('PUT', `/api/sessions/${currentSession.id}`);
  setStatus('Saved.');
  setTimeout(() => setStatus(''), 2000);
});

// --- New session ---
btnNew.addEventListener('click', async () => {
  const session = await api('POST', '/api/sessions');
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
  return escaped.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
}

// --- Helpers ---
function setUiEnabled(enabled) {
  inputEl.disabled = !enabled;
  btnSend.disabled = !enabled;
  btnSave.disabled = !enabled || !currentSession;
  if (enabled) inputEl.focus();
}

function setStatus(text) {
  statusEl.textContent = text;
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
  if (!confirm('Wipe all stored memories? This cannot be undone.')) return;
  await api('DELETE', '/api/memories');
  setStatus('Memory wiped.');
  setTimeout(() => setStatus(''), 2000);
});

// --- Init ---
loadSessionList();
