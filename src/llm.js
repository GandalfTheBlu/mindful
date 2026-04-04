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

// Stream a response that may contain tool calls.
// - If the model calls tools: accumulates them silently, returns { toolCalls: [...], content: '' }
// - If the model responds with text: streams each chunk via onChunk, returns { toolCalls: null, content }
// toolCalls entries: { id, name, arguments } (arguments is a raw JSON string)
export async function streamOrToolCalls(messages, tools, onChunk, options = {}) {
  const res = await fetch(`${llmBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, tools, ...options })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM stream error ${res.status}: ${body.slice(0, 500)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Accumulate tool calls by index (fragments arrive across multiple chunks)
  const tcMap = {};
  let hasToolCalls = false;
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        if (hasToolCalls) {
          return {
            toolCalls: Object.values(tcMap).map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
            content: ''
          };
        }
        return { toolCalls: null, content };
      }

      try {
        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            if (!tcMap[tc.index]) tcMap[tc.index] = { id: '', name: '', arguments: '' };
            if (tc.id) tcMap[tc.index].id = tc.id;
            if (tc.function?.name) tcMap[tc.index].name += tc.function.name;
            if (tc.function?.arguments) tcMap[tc.index].arguments += tc.function.arguments;
          }
        }

        if (delta?.content && !hasToolCalls) {
          onChunk(delta.content);
          content += delta.content;
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  // Stream ended without [DONE]
  if (hasToolCalls) {
    return {
      toolCalls: Object.values(tcMap).map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      content: ''
    };
  }
  return { toolCalls: null, content };
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
