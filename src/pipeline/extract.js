import { complete } from '../llm.js';
import { addMemory } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [extract] ${label}`, data ?? '');
}

const EXTRACT_SYSTEM = `/no_think
You extract long-term facts about the user from what they explicitly wrote. Rules:
- Only extract something the user directly stated about themselves (a fact, preference, opinion, goal, skill, relationship, or belief).
- Do not infer, interpret, or generate anything beyond what was literally said.
- Do not extract questions, greetings, or conversational intent.
- If the message mentions several related things about the same subject, consolidate them into one self-contained statement.
- If the message contains genuinely unrelated facts (e.g. "I have a dog" and "I am studying physics"), output each as a separate line.
- Each statement must be fully self-contained: never use pronouns like "it", "they", or "this" — always name the subject explicitly.
- Each statement must start with "The user".
- If the message contains no explicit personal facts, output <NOTHING>.
- Do NOT include dates — those are added by the system.
- Output only the statements, nothing else.`;

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

  const today = new Date().toISOString().slice(0, 10);
  const facts = response
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('The user'));

  if (facts.length === 0) return [];

  const stored = [];
  for (const fact of facts) {
    const dated = `${fact} [${today}]`;
    log('result', dated);
    await addMemory(userId, dated);
    log('stored', dated);
    stored.push(dated);
  }

  return stored;
}
