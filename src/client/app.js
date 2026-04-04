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
const btnBrief = document.getElementById('btn-brief');
const btnTts = document.getElementById('btn-tts');
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
  const statusEl = document.createElement('div');
  statusEl.className = 'stream-status';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const textSpan = document.createElement('span');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  textSpan.appendChild(cursor);
  bubble.appendChild(textSpan);
  assistantDiv.appendChild(statusEl);
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

  // Start streaming TTS immediately — feed sentences as text arrives
  if (activeTTS) { activeTTS.stop(); activeTTS = null; }
  const streamTTS = ttsEnabled ? new StreamingTTS(bubble) : null;
  if (streamTTS) activeTTS = streamTTS;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === 'status') {
        statusEl.textContent = event.label;
        scrollToBottom();
      } else if (event.type === 'chunk') {
        streamedText += event.content;
        textSpan.innerHTML = renderBold(streamedText);
        textSpan.appendChild(cursor);
        if (streamTTS) streamTTS.feedChunk(event.content);
        scrollToBottom();
      } else if (event.type === 'done') {
        statusEl.remove();
        cursor.remove();
        if (streamTTS) streamTTS.flush();
        setUiEnabled(true);
      } else if (event.type === 'error') {
        statusEl.remove();
        cursor.remove();
        if (streamTTS) streamTTS.stop();
        bubble.textContent = `Error: ${event.message}`;
        setUiEnabled(true);
      }
    }
  }
});

// --- Briefing ---
btnBrief.addEventListener('click', async () => {
  if (!currentSession) return;
  setUiEnabled(false);
  btnBrief.textContent = 'Loading…';

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  bubble.appendChild(cursor);
  assistantDiv.appendChild(bubble);
  messages.appendChild(assistantDiv);
  scrollToBottom();

  const res = await fetch(`/api/sessions/${currentSession.id}/brief`, { method: 'POST' });

  if (!res.ok) {
    const err = await res.json();
    bubble.textContent = `Error: ${err.error}`;
    setUiEnabled(true);
    btnBrief.textContent = 'Briefing';
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
        if (event.generated) {
          currentSession = await api('GET', `/api/sessions/${currentSession.id}`);
          if (streamedText) speakText(streamedText, assistantDiv);
        } else {
          assistantDiv.remove();
        }
        setUiEnabled(true);
        btnBrief.textContent = 'Briefing';
      } else if (event.type === 'error') {
        cursor.remove();
        bubble.textContent = `Error: ${event.message}`;
        setUiEnabled(true);
        btnBrief.textContent = 'Briefing';
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
  setUiEnabled(false);
  await loadSessionList();
  await streamOpener(session.id);
  setUiEnabled(true);
  inputEl.focus();
});

async function streamOpener(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/open`, { method: 'POST' });
  if (!res.ok || res.headers.get('content-type')?.includes('application/json')) return;

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  bubble.appendChild(cursor);
  assistantDiv.appendChild(bubble);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';
  let hasContent = false;

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
        if (!hasContent) {
          messages.appendChild(assistantDiv);
          hasContent = true;
        }
        streamedText += event.content;
        bubble.innerHTML = renderBold(streamedText);
        bubble.appendChild(cursor);
        scrollToBottom();
      } else if (event.type === 'done') {
        cursor.remove();
        if (hasContent) {
          // Refresh session so it has the opener message
          currentSession = await api('GET', `/api/sessions/${sessionId}`);
        }
      }
    }
  }
}

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
    .replace(/https?:\/\/[^\s<>"']+/g, url => {
      const trimmed = url.replace(/[.,;:!?)"']+$/, '');
      return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/gs, '<em>$1</em>');
}

// --- Helpers ---
function setUiEnabled(enabled) {
  inputEl.disabled = !enabled;
  btnSend.disabled = !enabled;
  btnSave.disabled = !enabled || !currentSession;
  btnBrief.disabled = !enabled || !currentSession;
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

// --- User model ---
const userModelModal = document.getElementById('user-model-modal');
const userModelContent = document.getElementById('user-model-content');

document.getElementById('btn-user-model').addEventListener('click', async () => {
  userModelContent.textContent = 'Loading…';
  userModelModal.hidden = false;
  const { model } = await api('GET', `/api/usermodel?userId=${encodeURIComponent(currentUserId)}`);
  userModelContent.textContent = model ?? 'No user model has been synthesized yet.';
});

document.getElementById('btn-close-user-model').addEventListener('click', () => {
  userModelModal.hidden = true;
});

userModelModal.addEventListener('click', e => {
  if (e.target === userModelModal) userModelModal.hidden = true;
});

userModelModal.addEventListener('keydown', e => {
  if (e.key === 'Escape') userModelModal.hidden = true;
});

// --- Wipe memory ---
document.getElementById('btn-wipe-memory').addEventListener('click', async () => {
  if (!confirm(`Wipe all memories for "${currentUserId}"? This cannot be undone.`)) return;
  await api('DELETE', `/api/memories?userId=${encodeURIComponent(currentUserId)}`);
});

// --- Memory search ---
const memoryModal = document.getElementById('memory-search-modal');
const memorySearchInput = document.getElementById('memory-search-input');
const memorySearchType = document.getElementById('memory-search-type');
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

function formatDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function runMemorySearch() {
  const query = memorySearchInput.value.trim();
  if (!query) return;

  const limit = Math.min(Math.max(parseInt(memorySearchLimit.value) || 10, 1), 100);
  const type = memorySearchType.value || undefined;
  memorySearchResults.innerHTML = '<div class="memory-search-empty">Searching…</div>';

  const results = await api('POST', '/api/memories/search', { query, limit, userId: currentUserId, type });

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

    const body = document.createElement('div');
    body.className = 'memory-body';

    const text = document.createElement('div');
    text.className = 'memory-text';
    text.textContent = r.text;

    const meta = document.createElement('div');
    meta.className = 'memory-meta';

    const typeBadge = document.createElement('span');
    typeBadge.className = `memory-type memory-type--${r.type}`;
    typeBadge.textContent = r.type;

    const conf = document.createElement('span');
    conf.textContent = `${Math.round(r.confidence * 100)}% conf`;

    const created = document.createElement('span');
    created.textContent = formatDate(r.createdAt) ?? '';

    const accessed = document.createElement('span');
    accessed.textContent = r.accessCount > 0
      ? `accessed ${r.accessCount}×, last ${formatDate(r.lastAccessed)}`
      : 'never accessed';

    meta.appendChild(typeBadge);
    meta.appendChild(conf);
    meta.appendChild(created);
    meta.appendChild(accessed);

    body.appendChild(text);
    body.appendChild(meta);
    row.appendChild(score);
    row.appendChild(body);
    memorySearchResults.appendChild(row);
  }
}

// --- TTS ---
let ttsEnabled = localStorage.getItem('mindful_tts') !== 'false';
let ttsAudioCtx = null;
let activeTTS = null; // current StreamingTTS instance

function updateTtsButton() {
  btnTts.textContent = ttsEnabled ? '\u{1F50A}' : '\u{1F507}';
  btnTts.style.opacity = ttsEnabled ? '1' : '0.4';
}

btnTts.addEventListener('click', () => {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem('mindful_tts', ttsEnabled);
  updateTtsButton();
  if (!ttsEnabled && activeTTS) { activeTTS.stop(); activeTTS = null; }
});

function getAudioCtx() {
  if (!ttsAudioCtx || ttsAudioCtx.state === 'closed') ttsAudioCtx = new AudioContext();
  return ttsAudioCtx;
}

// Split buffered text into speakable sentences, return [sentences, remainder].
// Splits on sentence-ending punctuation followed by whitespace, keeping only
// chunks of at least MIN_CHARS to avoid sending fragments like "1." or "e.g.".
const MIN_CHUNK_CHARS = 60;
const SENTENCE_END = /[.!?]+\s+/g;

function extractSentences(buffer) {
  const sentences = [];
  let lastIndex = 0;
  let match;
  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const chunk = buffer.slice(lastIndex, end).trim();
    if (chunk.length >= MIN_CHUNK_CHARS) {
      sentences.push(chunk);
      lastIndex = end;
    }
  }
  return [sentences, buffer.slice(lastIndex)];
}

function drawWaveformFrame(canvas, analyser, dataArray) {
  if (canvas.offsetWidth && canvas.offsetWidth !== canvas.width) canvas.width = canvas.offsetWidth;
  const ctx = canvas.getContext('2d');
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#6a9fb5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const sliceWidth = canvas.width / dataArray.length;
  let x = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

class StreamingTTS {
  constructor(bubble) {
    this.bubble = bubble;
    this.buffer = '';
    this.ctx = getAudioCtx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.ctx.destination);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.nextStartTime = null;
    this.endTime = null;
    this.queue = Promise.resolve();
    this.canvas = null;
    this.animId = null;
    this.stopped = false;
  }

  feedChunk(chunk) {
    if (this.stopped) return;
    this.buffer += chunk;
    const [sentences, remainder] = extractSentences(this.buffer);
    this.buffer = remainder;
    for (const s of sentences) this._enqueue(s);
  }

  flush() {
    const remainder = this.buffer.trim();
    this.buffer = '';
    if (remainder.length >= 2) this._enqueue(remainder);
    // After all audio is scheduled, stop waveform when last chunk ends
    this.queue.then(() => {
      if (this.stopped) return;
      const delay = this.endTime ? Math.max(0, (this.endTime - this.ctx.currentTime) * 1000) : 0;
      setTimeout(() => this._stopWaveform(), delay + 200);
    });
  }

  stop() {
    this.stopped = true;
    try { this.analyser.disconnect(); } catch {}
    this._stopWaveform();
  }

  _enqueue(text) {
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (!res.ok) return;
        const wav = await res.arrayBuffer();
        if (this.stopped) return;
        const audioBuffer = await this.ctx.decodeAudioData(wav);
        if (this.stopped) return;

        const source = this.ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.analyser);

        const now = this.ctx.currentTime;
        const startTime = (this.nextStartTime && this.nextStartTime > now)
          ? this.nextStartTime
          : now + 0.05;
        source.start(startTime);
        this.nextStartTime = startTime + audioBuffer.duration;
        this.endTime = this.nextStartTime;

        if (!this.canvas) this._startWaveform();
      } catch (e) { /* ignore individual chunk failures */ }
    });
  }

  _startWaveform() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'waveform';
    this.canvas.height = 40;
    this.bubble.appendChild(this.canvas);
    this.canvas.width = this.canvas.offsetWidth || this.bubble.offsetWidth || 400;
    scrollToBottom();
    const loop = () => {
      if (!this.animId) return;
      drawWaveformFrame(this.canvas, this.analyser, this.dataArray);
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  _stopWaveform() {
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    if (this.canvas) {
      this.canvas.style.transition = 'opacity 0.5s';
      this.canvas.style.opacity = '0';
      setTimeout(() => this.canvas?.remove(), 500);
      this.canvas = null;
    }
  }
}

// Used by opener and briefing (full text already available)
async function speakText(text, messageDiv) {
  if (!ttsEnabled) return;
  if (activeTTS) { activeTTS.stop(); activeTTS = null; }
  const bubble = messageDiv.querySelector('.message-bubble');
  const tts = new StreamingTTS(bubble);
  activeTTS = tts;
  tts.feedChunk(text);
  tts.flush();
}

// --- Spotify auth banner ---
const spotifyAuthBanner = document.getElementById('spotify-auth-banner');
const spotifyAuthMsg = document.getElementById('spotify-auth-msg');
const btnSpotifyReauth = document.getElementById('btn-spotify-reauth');

async function checkSpotifyAuthStatus() {
  try {
    const status = await api('GET', '/api/spotify/auth-status');
    spotifyAuthBanner.hidden = status.valid;
    if (!status.valid) {
      spotifyAuthMsg.textContent = 'Spotify not connected';
      btnSpotifyReauth.disabled = false;
      btnSpotifyReauth.textContent = 'Connect';
    }
  } catch { spotifyAuthBanner.hidden = true; }
}

btnSpotifyReauth.addEventListener('click', async () => {
  btnSpotifyReauth.disabled = true;
  btnSpotifyReauth.textContent = 'Waiting…';

  const { url } = await api('POST', '/api/spotify/reauth');
  window.open(url, '_blank');

  const es = new EventSource('/api/spotify/reauth/wait');
  es.onmessage = e => {
    const event = JSON.parse(e.data);
    es.close();
    if (event.type === 'done') {
      spotifyAuthBanner.hidden = true;
    } else {
      spotifyAuthMsg.textContent = 'Auth failed — try again';
      btnSpotifyReauth.disabled = false;
      btnSpotifyReauth.textContent = 'Connect';
    }
  };
  es.onerror = () => {
    es.close();
    spotifyAuthMsg.textContent = 'Auth failed — try again';
    btnSpotifyReauth.disabled = false;
    btnSpotifyReauth.textContent = 'Connect';
  };
});

// --- Google auth banner ---
const googleAuthBanner = document.getElementById('google-auth-banner');
const googleAuthMsg = document.getElementById('google-auth-msg');
const btnGoogleReauth = document.getElementById('btn-google-reauth');

async function checkGoogleAuthStatus() {
  try {
    const status = await api('GET', '/api/google/auth-status');
    if (!status.valid) {
      googleAuthBanner.hidden = false;
      googleAuthMsg.textContent = 'Google auth expired';
      btnGoogleReauth.disabled = false;
      btnGoogleReauth.textContent = 'Re-authenticate';
    } else {
      googleAuthBanner.hidden = true;
    }
  } catch { /* no google config — ignore */ }
}

btnGoogleReauth.addEventListener('click', async () => {
  btnGoogleReauth.disabled = true;
  btnGoogleReauth.textContent = 'Waiting…';

  const { url } = await api('POST', '/api/google/reauth');
  window.open(url, '_blank');

  const es = new EventSource('/api/google/reauth/wait');
  es.onmessage = e => {
    const event = JSON.parse(e.data);
    es.close();
    if (event.type === 'done') {
      googleAuthBanner.hidden = true;
    } else {
      googleAuthMsg.textContent = 'Re-auth failed — try again';
      btnGoogleReauth.disabled = false;
      btnGoogleReauth.textContent = 'Re-authenticate';
    }
  };
  es.onerror = () => {
    es.close();
    googleAuthMsg.textContent = 'Re-auth failed — try again';
    btnGoogleReauth.disabled = false;
    btnGoogleReauth.textContent = 'Re-authenticate';
  };
});

// --- Init ---
renderUserDisplay();
loadSessionList();
checkGoogleAuthStatus();
checkSpotifyAuthStatus();
updateTtsButton();
