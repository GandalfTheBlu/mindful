import { complete } from '../llm.js';
import config from '../config.js';

const SYSTEM = `/no_think
You extract long-term facts about the user from what they explicitly wrote. Rules:
- Only extract things the user directly stated about themselves (facts, preferences, opinions, goals, skills, relationships, beliefs).
- Do not infer, interpret, or generate anything beyond what was literally said.
- Do not extract questions, greetings, or conversational intent.
- If the message contains no explicit personal facts, output <NOTHING>.
- Output one fact per line as a short third-person statement starting with "The user". Example: "The user enjoys hiking." Nothing else.`;

export async function extractMemories(userMessage, precedingMessages) {
  const context = precedingMessages
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const response = await complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Context:\n${context}\n\nUser message: ${userMessage}` }
    ],
    { max_tokens: config.memory.maxTokens }
  );

  if (response.includes('<NOTHING>')) return [];
  return response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}
