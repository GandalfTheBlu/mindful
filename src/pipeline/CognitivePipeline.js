import { retrieve } from './retrieve.js';
import { articulate } from './articulate.js';
import { extract } from './extract.js';
import { runConsolidation } from '../core/consolidation.js';
import { listAllItems } from '../core/vectraStore.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [pipeline] ${label}`, data ?? '');
}

export class CognitivePipeline {
  async process(session, userContent, onChunk) {
    log('turn:start', userContent.slice(0, 80));

    // --- Phase 1: Retrieve ---
    log('phase', 'retrieve');
    const { injected, injectedFormatted } = await retrieve(session, userContent);

    const llmContent = injectedFormatted.length > 0
      ? `${userContent}\n\n[Relevant memories]:\n${injectedFormatted.join('\n')}`
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

    const { userId } = session;

    // --- Phase 3: Extract ---
    log('phase', 'extract');
    const countBefore = (await listAllItems(userId)).length;
    const extracted = await extract(userContent, session.messages.slice(0, -2), userId);
    userMsg.extractedMemories = extracted;

    // --- Consolidation: run when every 5th memory is stored ---
    if (extracted.length > 0) {
      const countAfter = (await listAllItems(userId)).length;
      if (Math.floor(countAfter / 5) > Math.floor(countBefore / 5)) {
        log('phase', 'consolidation');
        try {
          await runConsolidation(userId);
        } catch (err) {
          console.error('[pipeline] consolidation error:', err.message);
        }
      }
    }

    log('turn:done', '');
    return { userMsg };
  }
}
