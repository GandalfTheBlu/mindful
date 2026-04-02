import { EventEmitter } from 'events';

// Singleton lock for the LLM server. The main chat handler holds the lock
// while generating a response. Inner thoughts listen for 'idle' to run
// between turns without contending with the main pipeline.
class LLMScheduler extends EventEmitter {
  constructor() {
    super();
    this._busy = false;
  }

  acquire() {
    this._busy = true;
  }

  release() {
    this._busy = false;
    this.emit('idle');
  }

  isBusy() {
    return this._busy;
  }
}

export default new LLMScheduler();
