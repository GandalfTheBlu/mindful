import config from './config.js';

const llmBase = `http://${config.llm.serverHost}:${config.llm.port}`;
const embeddingBase = `http://${config.embedding.serverHost}:${config.embedding.port}`;

export async function complete(messages, options = {}) {
  const res = await fetch(`${llmBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: false, ...options })
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

export async function stream(messages, onChunk, options = {}) {
  const res = await fetch(`${llmBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, ...options })
  });
  if (!res.ok) throw new Error(`LLM stream error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch { /* skip malformed chunks */ }
    }
  }
}

export async function embed(text) {
  const res = await fetch(`${embeddingBase}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text })
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}
