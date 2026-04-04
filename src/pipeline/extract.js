import { complete } from '../llm.js';
import { addMemory } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [extract] ${label}`, data ?? '');
}

const EXTRACT_SYSTEM = `/no_think
You extract a single long-term fact about the user from what they explicitly wrote. Rules:
- Only extract something the user directly stated about themselves (a fact, preference, opinion, goal, skill, relationship, or belief).
- Do not infer, interpret, or generate anything beyond what was literally said.
- Do not extract questions, greetings, or conversational intent.
- If the message mentions several related things, consolidate them into one self-contained statement.
- The statement must be fully self-contained: never use pronouns like "it", "they", or "this" — always name the subject explicitly.
- If the message contains no explicit personal facts, output <NOTHING>.
- Output exactly one concise third-person statement starting with "The user". Nothing else.`;

export async function extract(userContent, precedingMessages, userId) {
  const context = precedingMessages
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  log('input', userContent);

  const response = await complete(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `Context:\n${context}\n\nUser message: ${userContent}` }
    ],
    { max_tokens: config.memory.maxTokens }
  );

  if (response.includes('<NOTHING>')) {
    log('result', '(nothing)');
    return [];
  }

  const lines = response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const fact = lines[0];
  if (!fact) return [];

  log('result', fact);
  await addMemory(userId, fact);
  log('stored', fact);

  return [fact];
}
