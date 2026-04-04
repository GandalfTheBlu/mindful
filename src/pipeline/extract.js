import { complete } from '../llm.js';
import { addMemory } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [extract] ${label}`, data ?? '');
}

const CONFIDENCE_MAP = { high: 1.0, medium: 0.6, low: 0.3 };

const EXTRACT_SYSTEM = `/no_think
You extract long-term facts about the user from the "User message" line ONLY. The context is provided solely so you can resolve pronouns or references — do NOT extract anything from it.

Rules:
- Only extract something the user directly stated about themselves in the User message (a fact, preference, opinion, goal, skill, relationship, or belief).
- Do not infer, interpret, or generate anything beyond what was literally said in the User message.
- Do not extract questions, greetings, or conversational intent.
- Do not extract meta-commentary about the conversation itself such as "I changed my mind", "I think I said", or "I was wrong" — extract only the substantive fact that follows, if any.
- If the User message mentions several related things about the same subject, consolidate them into one self-contained statement.
- If the User message contains genuinely unrelated facts (e.g. "I have a dog" and "I am studying physics"), output each as a separate line.
- Each statement must be fully self-contained: never use pronouns like "it", "they", or "this" — always name the subject explicitly.
- Each statement must start with "The user".
- If the User message contains no explicit personal facts, output <NOTHING>.
- Do NOT include dates — those are added by the system.
- After each statement, append " | high", " | medium", or " | low" based on assertion strength: "high" for explicit firm declarations ("I am", "I love", "I always"), "medium" for hedged or uncertain language ("I think", "kind of", "maybe", "I guess"), "low" for anything very tentative or speculative.
- Output only the statements with confidence labels, nothing else.`;

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
  const lines = response
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('The user'));

  if (lines.length === 0) return [];

  const stored = [];
  for (const line of lines) {
    const pipeIdx = line.lastIndexOf(' | ');
    const fact = pipeIdx !== -1 ? line.slice(0, pipeIdx).trim() : line;
    const label = pipeIdx !== -1 ? line.slice(pipeIdx + 3).trim().toLowerCase() : 'high';
    const confidence = CONFIDENCE_MAP[label] ?? 1.0;
    const dated = `${fact} [${today}]`;
    log('result', `${dated} (confidence: ${confidence})`);
    await addMemory(userId, dated, confidence);
    log('stored', dated);
    stored.push(dated);
  }

  return stored;
}
