import { complete } from '../llm.js';
import { addMemory } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [extract] ${label}`, data ?? '');
}

const EXTRACT_SYSTEM = `/no_think
You extract long-term facts about the user from what they explicitly wrote. Rules:
- Only extract things the user directly stated about themselves (facts, preferences, opinions, goals, skills, relationships, beliefs).
- Do not infer, interpret, or generate anything beyond what was literally said.
- Do not extract questions, greetings, or conversational intent.
- Consolidate related facts into a single statement rather than splitting them into fragments.
- Output at most 2 facts total. Prefer 1 if the message is about a single topic.
- If the message contains no explicit personal facts, output <NOTHING>.
- Output one fact per line as a concise third-person statement starting with "The user". Nothing else.`;

export async function extract(userContent, precedingMessages) {
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

  const facts = response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  log('result', facts);

  for (const fact of facts) {
    await addMemory(fact);
    log('stored', fact);
  }

  return facts;
}
