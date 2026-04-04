import { retrieve } from './retrieve.js';
import { recognize } from './recognize.js';
import { articulate } from './articulate.js';
import { extract } from './extract.js';
import { runConsolidation } from '../core/consolidation.js';
import { listAllItems } from '../core/vectraStore.js';
import { getUserModel, maybeSynthesizeUserModel } from '../core/userModel.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [pipeline] ${label}`, data ?? '');
}

export class CognitivePipeline {
  async process(session, userContent, onChunk, onStatus = () => {}) {
    log('turn:start', userContent.slice(0, 80));

    const { userId } = session;

    // --- Phase 1: Retrieve ---
    log('phase', 'retrieve');
    onStatus('Recalling memories...');
    const { injected, injectedFormatted, procedural, expandedQuery } = await retrieve(session, userContent);

    // --- Phase 1b: Pattern recognition ---
    log('phase', 'recognize');
    onStatus('Analyzing patterns...');
    const observations = await recognize(userId, injected, expandedQuery);
    if (observations.length > 0) log('observations', observations);

    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const timestampedContent = `[${timestamp}] ${userContent}`;

    const llmContent = injectedFormatted.length > 0
      ? `${timestampedContent}\n\n[Relevant memories]:\n${injectedFormatted.join('\n')}`
      : timestampedContent;

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
    const userModel = getUserModel(userId);
    if (userModel) log('user-model', `${userModel.length} chars`);
    const assistantContent = await articulate(session, onChunk, observations, procedural, userModel, onStatus);
    session.messages.push({ role: 'assistant', content: assistantContent });

    // --- Phase 3: Extract ---
    log('phase', 'extract');
    onStatus('Extracting memories...');
    const countBefore = (await listAllItems(userId)).length;
    const extracted = await extract(userContent, session.messages.slice(0, -2), userId);
    userMsg.extractedMemories = extracted;

    if (extracted.length > 0) {
      onStatus(`Storing ${extracted.length} ${extracted.length === 1 ? 'memory' : 'memories'}...`);
      const countAfter = (await listAllItems(userId)).length;

      // --- Consolidation: run when every 5th memory is stored ---
      if (Math.floor(countAfter / 5) > Math.floor(countBefore / 5)) {
        log('phase', 'consolidation');
        onStatus('Consolidating memories...');
        try {
          await runConsolidation(userId);
        } catch (err) {
          console.error('[pipeline] consolidation error:', err.message);
        }
      }

      // --- User model synthesis: run when enough new memories have accumulated ---
      log('phase', 'user-model-synthesis');
      try {
        const finalCount = (await listAllItems(userId)).length;
        const ran = await maybeSynthesizeUserModel(userId, finalCount);
        if (!ran) log('user-model-synthesis', 'skipped (below threshold)');
      } catch (err) {
        console.error('[pipeline] user-model synthesis error:', err.message);
      }
    }

    log('turn:done', '');
    return { userMsg };
  }
}
