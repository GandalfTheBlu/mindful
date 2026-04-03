import { retrieve } from './retrieve.js';
import { articulate } from './articulate.js';
import { extract } from './extract.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [pipeline] ${label}`, data ?? '');
}

export class CognitivePipeline {
  async process(session, userContent, onChunk) {
    log('turn:start', userContent.slice(0, 80));

    // --- Phase 1: Retrieve ---
    log('phase', 'retrieve');
    const { injected, sampled } = await retrieve(session, userContent);

    const allMemories = [...new Set([...injected, ...sampled])];
    const llmContent = allMemories.length > 0
      ? `${userContent}\n\n[Relevant memories]:\n${allMemories.join('\n')}`
      : userContent;

    const userMsg = {
      role: 'user',
      content: userContent,
      llmContent,
      injectedMemories: injected,
      extractedMemories: []
    };
    session.messages.push(userMsg);

    // --- Phase 2: Articulate ---
    log('phase', 'articulate');
    const assistantContent = await articulate(session, onChunk);
    session.messages.push({ role: 'assistant', content: assistantContent });

    // --- Phase 3: Extract ---
    log('phase', 'extract');
    const extracted = await extract(userContent, session.messages.slice(0, -2));
    userMsg.extractedMemories = extracted;

    log('turn:done', '');
    return { userMsg };
  }
}
