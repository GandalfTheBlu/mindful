import { complete } from '../llm.js';
import { addMemory } from '../core/vectraStore.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [extract] ${label}`, data ?? '');
}

const CONFIDENCE_MAP = { high: 1.0, medium: 0.6, low: 0.3 };
const VALID_TYPES = new Set(['semantic', 'episodic', 'procedural', 'goal']);

const EXTRACT_SYSTEM = `/no_think
You extract long-term facts about the user from the "User message" line ONLY. The context is provided solely so you can resolve pronouns or references — do NOT extract anything from it.

Rules:
- Only extract something the user directly stated about themselves in the User message (a fact, preference, opinion, goal, skill, relationship, or belief).
- Do not infer, interpret, or generate anything beyond what was literally said in the User message.
- If the User message is a question, greeting, or contains no first-person declaration about the user, output <NOTHING>. A message that only asks something — even about the user themselves — contains no extractable fact.
- Do not extract conversational intent or anything that describes what was or was not said in the conversation. The output must always be a concrete fact about the user, never a description of the conversation itself.
- Do not extract meta-commentary about the conversation itself such as "I changed my mind", "I think I said", or "I was wrong" — extract only the substantive fact that follows, if any.
- If the User message mentions several related things about the same subject, consolidate them into one self-contained statement.
- If the User message contains genuinely unrelated facts (e.g. "I have a dog" and "I am studying physics"), output each as a separate line.
- Each statement must be fully self-contained and make sense to someone with no knowledge of the conversation. Use the context to resolve any vague references and write the resolved name or description directly into the statement — never leave in pronouns, demonstratives, or shorthand that only make sense in context.
- When a statement expresses a comparison, contrast, or preference, always include both sides so the statement is complete on its own.
- When the User message provides specific details (names, events, causes, or outcomes), those details must appear in the statement. Do not replace specific facts with general assessments like "is in a better situation" or "things improved". If the user names what changed, include those specifics.
- Each statement must start with "The user".
- If the User message contains no explicit personal facts, output <NOTHING>.
- Do NOT include dates — those are added by the system.
- After each statement, append " | <confidence> | <type>" where:
  - <confidence> is "high" for explicit declarations and factual updates (including corrections), "medium" for hedged language ("I think", "kind of", "maybe"), "low" for anything tentative or speculative.
  - <type> is one of:
    - "semantic" — a timeless trait, skill, belief, preference, or relationship about the user's life.
    - "episodic" — something that happened to the user or was true during a specific time or period.
    - "procedural" — an instruction for how this AI should write its responses: length, tone, format, or style. Only use this type when the user is directly telling you how to reply.
    - "goal" — something the user intends to do or achieve in the future.
- Output only the statements with labels, nothing else.`;

// Question-only messages can never contain extractable personal facts.
// Guard against the small model hallucinating from injected context.
const QUESTION_ONLY = /^(what|who|where|when|why|how|can|could|do|does|did|is|are|was|were|will|would|should|have|has)\b/i;

export async function extract(userContent, precedingMessages, userId) {
  const trimmed = userContent.trim();
  if (QUESTION_ONLY.test(trimmed) && trimmed.endsWith('?')) {
    log('result', '(skipped — pure question)');
    return [];
  }

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

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const lines = response
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('The user'));

  if (lines.length === 0) return [];

  const stored = [];
  for (const line of lines) {
    const parts = line.split(' | ');
    const fact = parts[0].trim();
    const label = (parts[1] ?? 'high').trim().toLowerCase();
    const typeRaw = (parts[2] ?? 'semantic').trim().toLowerCase();
    const confidence = CONFIDENCE_MAP[label] ?? 1.0;
    let type = VALID_TYPES.has(typeRaw) ? typeRaw : 'semantic';
    // Fallback: reclassify as procedural if the fact describes AI response style
    if (type === 'semantic' && /\b(responses?|replies|answers?)\b/i.test(fact) && /\b(prefers?|wants?|likes?|keep|make)\b/i.test(fact)) {
      type = 'procedural';
    }
    // Fallback: reclassify as episodic if the original message contained temporal markers
    // and the extracted fact uses past tense (describing something that happened)
    if (type === 'semantic'
      && /\b(last\s+\w+|yesterday|\d+\s+(days?|weeks?|months?|years?)\s+ago|just\s+(got|started|finished|quit|moved|got)|used\s+to|recently)\b/i.test(userContent)
      && /\b(was|were|got|started|finished|quit|moved|had|became|shipped|joined|left)\b/i.test(fact)) {
      type = 'episodic';
    }
    const dated = `${fact} [${now}]`;
    log('result', `${dated} (confidence: ${confidence}, type: ${type})`);
    await addMemory(userId, dated, confidence, type);
    log('stored', dated);
    stored.push(dated);
  }

  return stored;
}
