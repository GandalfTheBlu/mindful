import config from '../config.js';

const maxChars = config.llm.contextSize * config.contextHorizon.charsPerToken;
const defaultHorizonThreshold = Math.floor(maxChars * config.contextHorizon.summarizeAtPercent);

// Wraps a messages array and manages rolling summarization when the window
// exceeds its budget. The messages array is mutated in-place so callers that
// hold a reference (e.g. session.messages) stay in sync automatically.
export class ContextWindow {
  constructor(messages, { maxChars = defaultHorizonThreshold, summarizer, keepRecent = 4 } = {}) {
    this.messages = messages;
    this.maxChars = maxChars;
    this.summarizer = summarizer;
    this.keepRecent = keepRecent;
  }

  _totalChars() {
    return this.messages.reduce((sum, m) => sum + (m.llmContent ?? m.content).length, 0);
  }

  async condenseIfNeeded() {
    if (this._totalChars() <= this.maxChars) return;

    const toSummarize = this.messages.slice(0, -this.keepRecent);
    const toKeep = this.messages.slice(-this.keepRecent);
    if (toSummarize.length === 0) return;

    const summaryText = await this.summarizer(toSummarize);
    this.messages.splice(
      0,
      this.messages.length,
      { role: 'system', content: `[Summary of earlier conversation]: ${summaryText}`, isSummary: true },
      ...toKeep
    );
  }

  getMessages() {
    return this.messages;
  }
}
