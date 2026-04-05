import { streamOrToolCalls } from '../llm.js';
import { TOOLS, callTool, formatToolStatus } from '../tools/index.js';
import { ContextWindow } from '../context/ContextWindow.js';
import { summarize } from '../core/summarizer.js';
import config from '../config.js';

const maxChars = config.llm.contextSize * config.contextHorizon.charsPerToken;
const CHAT_MAX_CHARS = Math.floor(maxChars * config.contextHorizon.summarizeAtPercent);
const CHAT_KEEP_RECENT = 4;

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [articulate] ${label}`, data ?? '');
}

const SYSTEM = `You are an AI having a casual conversation. Be direct and natural — no bullet points, no formal structure, no assistant-speak. Do not pretend to be human. Stay honest, stay casual.`;

// Filters <think>...</think> from the stream: logs think content to console,
// passes everything else to onChunk. Returns the visible response content.
function makeThinkFilter(onChunk) {
  let buffer = '';
  let mode = 'start'; // 'start' | 'thinking' | 'responding'
  let thinkBuffer = '';
  let responseContent = '';

  function processChunk(chunk) {
    if (mode === 'responding') {
      onChunk(chunk);
      responseContent += chunk;
      return;
    }

    buffer += chunk;

    if (mode === 'start') {
      const tag = '<think>';
      if (buffer.startsWith(tag)) {
        mode = 'thinking';
        buffer = buffer.slice(tag.length);
      } else if (buffer.length >= tag.length || !tag.startsWith(buffer)) {
        // Definitely not a think tag — flush buffer and switch to responding
        mode = 'responding';
        onChunk(buffer);
        responseContent += buffer;
        buffer = '';
        return;
      }
      // else: still possibly building toward <think>, keep buffering
    }

    if (mode === 'thinking') {
      const endTag = '</think>';
      const endIdx = buffer.indexOf(endTag);
      if (endIdx !== -1) {
        thinkBuffer += buffer.slice(0, endIdx);
        log('think', `\n${'─'.repeat(60)}\n${thinkBuffer}\n${'─'.repeat(60)}`);
        const rest = buffer.slice(endIdx + endTag.length).replace(/^\n+/, '');
        buffer = '';
        mode = 'responding';
        if (rest) {
          onChunk(rest);
          responseContent += rest;
        }
      } else {
        thinkBuffer += buffer;
        buffer = '';
      }
    }
  }

  function flush() {
    // Called after stream ends — flush any remaining buffer
    if (buffer && mode !== 'thinking') {
      onChunk(buffer);
      responseContent += buffer;
      buffer = '';
    }
    return responseContent;
  }

  return { processChunk, flush };
}


export async function articulate(session, onChunk, observations = [], procedural = [], userModelSummary = null, userModelFull = null, injectedCount = 0, onStatus = () => {}) {
  // Condense chat history if approaching horizon
  const window = new ContextWindow(session.messages, {
    maxChars: CHAT_MAX_CHARS,
    summarizer: summarize,
    keepRecent: CHAT_KEEP_RECENT
  });
  await window.condenseIfNeeded();

  const llmMessages = session.messages.map(m => ({
    role: m.role,
    content: m.llmContent ?? m.content
  }));

  let systemContent = SYSTEM;
  // Always inject the summary (grounding). Only inject the full profile when
  // retrieval found no specific memories — otherwise it adds noise.
  if (userModelSummary) {
    systemContent += `\n\n[About this user]\n${userModelSummary}`;
    if (injectedCount === 0 && userModelFull) {
      systemContent += `\n\n[Full user profile]\n${userModelFull}`;
    }
  }
  if (procedural.length > 0) {
    systemContent += `\n\n[User preferences for your responses]\n${procedural.join('\n')}`;
  }
  if (observations.length > 0) {
    systemContent += `\n\n[Observations about the user - use only if directly relevant to the conversation]\n${observations.join('\n')}`;
  }

  let currentMessages = [{ role: 'system', content: systemContent }, ...llmMessages];
  let responseContent = '';
  const allToolResults = [];
  const maxToolIterations = 10;
  let toolIterations = 0;

  // Turn-local context passed to every tool call.
  // listedDirs resets each turn; fileCache persists in session across turns.
  const toolContext = { listedDirs: new Set(), session, userId: session.userId };

  while (true) {
    const filter = makeThinkFilter(onChunk);
    const { toolCalls } = await streamOrToolCalls(currentMessages, TOOLS, chunk => filter.processChunk(chunk));
    responseContent = filter.flush();

    if (!toolCalls) break;

    if (++toolIterations > maxToolIterations) {
      log('tool-loop-limit', `reached ${maxToolIterations} tool iterations, stopping`);
      break;
    }

    log('tool-calls', toolCalls.map(tc => tc.name).join(', '));

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments }
        }))
      }
    ];

    for (const tc of toolCalls) {
      onStatus(formatToolStatus(tc.name, tc.arguments));
      let result;
      try {
        result = await callTool(tc.name, JSON.parse(tc.arguments), toolContext, onStatus);
      } catch (err) {
        result = `Error: ${err.message}`;
      }
      log('tool-result', `${tc.name} → ${String(result).slice(0, 120)}`);
      allToolResults.push({ name: tc.name, result: String(result) });
      currentMessages.push({ role: 'tool', content: String(result), tool_call_id: tc.id });
    }
  }

  return { content: responseContent, toolResults: allToolResults };
}
