import { retrieve } from './retrieve.js';
import { recognize } from './recognize.js';
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

    const { userId } = session;

    // --- Phase 1: Retrieve ---
    log('phase', 'retrieve');
    const { injected, injectedFormatted, procedural, expandedQuery } = await retrieve(session, userContent);

    // --- Phase 1b: Pattern recognition ---
    log('phase', 'recognize');
    const observations = await recognize(userId, injected, expandedQuery);
    if (observations.length > 0) log('observations', observations);

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
    const assistantContent = await articulate(session, onChunk, observations, procedural);
    session.messages.push({ role: 'assistant', content: assistantContent });

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
