import { stream } from '../llm.js';
import { listByTypeWithMeta } from '../core/vectraStore.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [opener] ${label}`, data ?? '');
}

const OPENER_SYSTEM = `/no_think
You are beginning a new session with a user you have prior context about. Using the provided context, write a short, casual opening line (one or two sentences). Be specific — reference something concrete from the context rather than speaking in generalities. Do not use bullet points or formal structure. Do not ask more than one question. If the context is too sparse to say anything meaningful, output only: SKIP`;

export async function generateOpener(session, daysSinceLastSession, onChunk) {
  const { userId } = session;

  const goals = await listByTypeWithMeta(userId, 'goal');
  const episodic = await listByTypeWithMeta(userId, 'episodic');

  if (goals.length === 0 && episodic.length === 0) {
    log('skip', 'no goals or episodic memories');
    return null;
  }

  // Most recent 5 episodic memories
  const recentEpisodic = episodic
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  const lines = [];

  if (daysSinceLastSession != null) {
    const d = Math.round(daysSinceLastSession);
    lines.push(`Time since last session: ${d === 0 ? 'less than a day' : `${d} day${d !== 1 ? 's' : ''}`}`);
  }

  if (goals.length > 0) {
    lines.push('');
    lines.push('Goals:');
    for (const g of goals) lines.push(`- ${g.text}`);
  }

  if (recentEpisodic.length > 0) {
    lines.push('');
    lines.push('Recent experiences:');
    for (const e of recentEpisodic) lines.push(`- ${e.text}`);
  }

  const contextContent = lines.join('\n');
  log('context', `${goals.length} goals, ${recentEpisodic.length} episodic memories, daysSince=${daysSinceLastSession}`);

  let content = '';
  await stream(
    [
      { role: 'system', content: OPENER_SYSTEM },
      { role: 'user', content: contextContent }
    ],
    chunk => {
      content += chunk;
      onChunk(chunk);
    },
    { max_tokens: 120 }
  );

  content = content.trim();
  if (!content || content.toUpperCase() === 'SKIP') {
    log('skip', 'model returned SKIP or empty');
    return null;
  }

  log('result', content.slice(0, 100));
  return content;
}
