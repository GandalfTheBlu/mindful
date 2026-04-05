import { complete } from '../llm.js';
import { webSearch } from './webSearch.js';
import { webFetch } from './webFetch.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [webResearch] ${label}`, data ?? '');
}

const AGENT_SYSTEM = `/no_think
You are a focused web research agent. You are given a topic, a goal, and today's date. Use the available actions to find the information needed, then report your findings.

At each step output exactly one action on its own line:
SEARCH: <query>                          — search the web with this query
FETCH: <url> KEYWORDS: kw1, kw2, kw3    — fetch a page; keywords filter which sections are read
ANSWER: <text>                           — your final synthesised answer (stop after this)

Guidelines:
- Begin with a SEARCH. Always include the current year in date-sensitive queries.
- After reviewing search results, either refine with another SEARCH or FETCH the most relevant URL.
- Always include KEYWORDS when fetching. Keywords must be specific content words that appear in the body of the page — names of people, places, organisations, events, or domain-specific terms. Do not use generic labels like "news", "breaking", "world", "events", "upcoming" — these match navigation and headers, not article content, and will return nothing useful.
- If a fetch returns TOO_MANY_CHUNKS, your keywords matched too much of the page. Retry the same FETCH with narrower, more specific keywords.
- Fetch pages that are most likely to contain the specific details the goal requires.
- Stop as soon as you can give a complete, accurate ANSWER. Do not fetch unnecessarily.
- If two searches return nothing useful, provide the best ANSWER you can from what you have.
- The ANSWER must directly address the goal: be specific, include key details (names, dates, locations).`;

export async function webResearch({ topic, goal }, onStatus = () => {}) {
  const maxIterations = config.tools?.webResearch?.maxIterations ?? 6;
  log('start', `topic="${topic}" goal="${goal.slice(0, 80)}"`);

  const today = new Date().toISOString().slice(0, 10);
  const messages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: `Today's date: ${today}\nTopic: ${topic}\nGoal: ${goal}` }
  ];

  let iterations = 0;
  while (iterations < maxIterations) {
    const response = await complete(messages, { max_tokens: 300, temperature: 0.1 });
    messages.push({ role: 'assistant', content: response });
    log(`iter-${iterations + 1}`, response.slice(0, 120).replace(/\n/g, ' '));

    const answerMatch = response.match(/^ANSWER:\s*([\s\S]+)/m);
    if (answerMatch) {
      const answer = answerMatch[1].trim();
      log('done', `${answer.length} chars in ${iterations + 1} iteration(s): ${answer.slice(0, 120).replace(/\n/g, ' ')}`);
      onStatus('✓');
      return answer;
    }

    const searchMatch = response.match(/^SEARCH:\s*(.+)/m);
    const fetchMatch  = response.match(/^FETCH:\s*(https?:\/\/[^\s]+)(.*)/m);

    let tooManyChunks = false;

    if (searchMatch) {
      const query = searchMatch[1].trim();
      log('search', query);
      onStatus(`Web search: ${query}`);
      try {
        const results = await webSearch({ query });
        messages.push({ role: 'user', content: `Search results for "${query}":\n${results}` });
      } catch (err) {
        messages.push({ role: 'user', content: `Search failed: ${err.message}` });
      }
    } else if (fetchMatch) {
      const url = fetchMatch[1].trim();
      const kwRaw = fetchMatch[2]?.match(/KEYWORDS?:\s*(.+)/i)?.[1] ?? '';
      const keywords = kwRaw.split(/,\s*/).map(k => k.trim()).filter(Boolean);
      log('fetch', `${url}${keywords.length ? ` [${keywords.join(', ')}]` : ''}`);
      onStatus(`Web fetch: ${url}`);
      try {
        const content = await webFetch({ url, task: goal, keywords }, label => onStatus(label));
        tooManyChunks = content.startsWith('TOO_MANY_CHUNKS');
        messages.push({ role: 'user', content: `Content from ${url}:\n${content}` });
      } catch (err) {
        messages.push({ role: 'user', content: `Fetch failed: ${err.message}` });
      }
    } else {
      messages.push({ role: 'user', content: 'Output exactly one of: SEARCH: <query>, FETCH: <url> KEYWORDS: kw1, kw2, ..., or ANSWER: <text>' });
    }

    // TOO_MANY_CHUNKS retries don't consume an iteration — the agent just needs
    // to pick tighter keywords for the same URL, which is instant to decide.
    if (!tooManyChunks) iterations++;
  }

  // Max iterations reached — force a final answer
  messages.push({ role: 'user', content: 'You have reached the research limit. Output your ANSWER now based on everything gathered.' });
  const final = await complete(messages, { max_tokens: 400, temperature: 0.1 });
  const answer = final.replace(/^ANSWER:\s*/m, '').trim();
  log('done-forced', `${answer.length} chars: ${answer.slice(0, 120).replace(/\n/g, ' ')}`);
  onStatus('✓');
  return answer;
}
