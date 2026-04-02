import { complete } from '../llm.js';
import scheduler from '../LLMScheduler.js';
import { sampleDistantMemories } from './MemorySampler.js';
import { SurfacingGate } from './SurfacingGate.js';
import { ContextWindow } from '../context/ContextWindow.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [thoughts] ${label}`, data ?? '');
}

const THOUGHT_SYSTEM = `You are an inner reflection process running alongside a conversation. You receive:
- Memories about the user (possibly unrelated to the current topic)
- Recent conversation turns
- Your own prior thoughts

Find unexpected connections or insights that could genuinely enrich the conversation. Be critical — most connections are superficial. Only rate something highly if it would meaningfully change how the conversation could go.

Respond in exactly this format:
THOUGHT: <your reflection, 1-3 sentences>
SCORE: <integer 1-10, where 10 = profound insight worth surfacing immediately>
REASON: <one sentence justifying the score>`;

const SCORE_THRESHOLD = 7;

// 30% of the main context budget for the thought history window
const maxChars = config.llm.contextSize * config.contextHorizon.charsPerToken;
const THOUGHT_MAX_CHARS = Math.floor(maxChars * 0.3);
const THOUGHT_KEEP_RECENT = 3;

// Summarizer for the thought window — more terse than the main chat summarizer
async function thoughtSummarizer(messages) {
  const transcript = messages.map(m => m.content).join('\n');
  return complete(
    [
      { role: 'system', content: 'Compress these internal thoughts into a brief summary. Keep any high-value insights. Output only the compressed text.' },
      { role: 'user', content: transcript }
    ],
    { max_tokens: 256 }
  );
}

export class InnerThoughtsEngine {
  constructor() {
    this._gate = new SurfacingGate();
    this._pending = null;
    this._activeSession = null;
    this._running = false;

    // Own rolling context window for thought history
    this._thoughtMessages = [];
    this._window = new ContextWindow(this._thoughtMessages, {
      maxChars: THOUGHT_MAX_CHARS,
      summarizer: thoughtSummarizer,
      keepRecent: THOUGHT_KEEP_RECENT
    });

    scheduler.on('idle', () => this._onIdle());
  }

  // Set by chatServer when a session becomes active
  setActiveSession(session) {
    this._activeSession = session;
  }

  // Called on each new user message to open the surfacing slot
  resetGate() {
    this._gate.reset();
  }

  // Consume a pending thought (returns null if none). Called by chatServer
  // after the assistant response is done, before sending 'done' event.
  takePending() {
    const t = this._pending;
    this._pending = null;
    return t;
  }

  async _onIdle() {
    if (this._running || scheduler.isBusy()) return;
    this._running = true;
    try {
      await this._think();
    } catch (err) {
      log('error', err.cause ? `${err.message} — ${err.cause.message ?? err.cause}` : err.message);
    } finally {
      this._running = false;
    }
  }

  async _think() {
    const memories = await sampleDistantMemories(3);
    const recentChat = this._activeSession
      ? this._activeSession.messages.slice(-6).filter(m => !m.isSummary)
      : [];

    if (memories.length === 0 && recentChat.length === 0) return;

    const memoryBlock = memories.length > 0
      ? `[Sampled memories]:\n${memories.join('\n')}`
      : '';

    const chatBlock = recentChat.length > 0
      ? `[Recent conversation]:\n${recentChat.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}`
      : '';

    const priorBlock = this._thoughtMessages.length > 0
      ? `[Prior thoughts]:\n${this._thoughtMessages.slice(-3).map(m => m.content).join('\n')}`
      : '';

    const prompt = [memoryBlock, chatBlock, priorBlock].filter(Boolean).join('\n\n');

    log('prompt', `\n${'─'.repeat(60)}\n${prompt}\n${'─'.repeat(60)}`);
    const response = await complete(
      [
        { role: 'system', content: THOUGHT_SYSTEM },
        { role: 'user', content: prompt }
      ],
      { max_tokens: 200 }
    );

    const thought = parseThought(response);
    if (!thought) {
      log('parse failed', response);
      return;
    }

    log(`response score=${thought.score}`, `\n${thought.text}`);

    // Always record in own context window
    await this._window.condenseIfNeeded();
    this._thoughtMessages.push({ role: 'assistant', content: thought.text });

    // Surface if above threshold and gate is open for this turn
    if (thought.score >= SCORE_THRESHOLD && this._gate.tryAcquire()) {
      log('surfacing', thought.text);
      this._pending = thought.text;
    }
  }
}

function parseThought(response) {
  const thoughtMatch = response.match(/THOUGHT:\s*(.+?)(?=\nSCORE:|$)/s);
  const scoreMatch = response.match(/SCORE:\s*(\d+)/);
  if (!thoughtMatch || !scoreMatch) return null;
  const score = parseInt(scoreMatch[1], 10);
  if (isNaN(score)) return null;
  return { text: thoughtMatch[1].trim(), score };
}
