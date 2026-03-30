import { complete } from '../llm.js';

const SYSTEM = `Summarize the following conversation from a third-person perspective. Be concise. Capture key facts, decisions, and context. Output only the summary text.`;

export async function summarize(messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return complete(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: transcript }
    ],
    { max_tokens: 512 }
  );
}
