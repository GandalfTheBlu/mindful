# mindful — Roadmap

## ~~Phase 1: Memory Lifecycle (Forgetting & Consolidation)~~ ✓

**Goal:** Prevent the vector store from bloating and degrading over time.

- Add `lastAccessed` and `accessCount` metadata to each memory. Update on every retrieval hit.
- **Decay pass:** Remove memories that have never been accessed and haven't been touched in a long time.
- **Redundancy pass:** Cluster memories by similarity (cosine > ~0.92). Ask the LLM to merge each cluster into a single canonical statement.
- **Contradiction pass:** Flag pairs that semantically contradict each other. Resolve by recency, or surface to the user.
- **Abstraction pass:** When N specific memories share a theme, replace them with a single generalization. Signal preserved, token cost reduced.
- Trigger: run consolidation at session end, or when memory count crosses a configurable threshold.

**Additional work completed beyond original spec:**
- Multi-fact extraction: a single message can produce multiple self-contained memories for genuinely unrelated facts.
- Date embedding: every extracted memory carries a `[YYYY-MM-DD]` tag in its text, enabling date-based similarity queries ("what did I do on X?") and temporal reasoning without metadata filtering.
- LLM query expansion: before embedding the retrieval query, an LLM call rewrites it into a richer description of what personal information would be relevant — fixes cross-session retrieval for abstract/indirect references like "my instrument".
- Retrieval deduplication fix: `alreadyInContext` now tracks only explicitly injected memories, not extracted ones — memories from earlier in a session are now injectable.
- Removed random sampling: the random 3-memory sample injected every turn was pure noise, removed in favour of targeted retrieval only.
- Consolidation ordering: contradiction pass runs before redundancy to prevent genuine updates from being merged away as near-duplicates before they can be resolved.
- Abstraction is conservative by design (threshold 0.80, min cluster 6): specific facts are too valuable to collapse into vague generalisations unless the cluster is very large and tightly similar.

---

## ~~Phase 2: Confidence-Weighted Memories~~ ✓

**Goal:** Stop treating all extracted memories as ground truth — weight them by how strongly they were asserted.

- Extraction prompt outputs `fact | high/medium/low`; mapped to 1.0 / 0.6 / 0.3 and stored in metadata.
- Low-confidence memories (< 0.5) get an `[uncertain]` prefix when injected into LLM context.
- Fast decay: low-confidence memories that are never accessed expire after 3 days instead of 14.
- Access boost: every retrieval hit bumps confidence by +0.05 (capped at 1.0) — confirmed facts accumulate weight over time.
- Confidence propagates through consolidation: contradiction resolution uses B's confidence, redundancy uses cluster average, abstraction uses cluster minimum.
- Meta-commentary filter added to extraction prompt.
- Factual corrections ("actually I quit", "actually it's X") correctly rated high-confidence, not penalised for the word "actually".

**Additional work completed beyond original spec:**
- Code-level question guard: messages that start with a question word and end with `?` skip extraction entirely — the 8B model cannot reliably follow the "output NOTHING for questions" rule in the prompt alone.
- Specificity rule: extraction prompt now requires specific details (events, causes, outcomes) to appear in the statement rather than being collapsed into a vague general assessment.
- Contradiction sort: items sorted by `createdAt` ascending before contradiction pass so B is always genuinely newer than A.
- Temporal superseding: contradiction detection prompt extended to catch superseded states ("was struggling with X, now X is resolved") — prevents these from being merged as near-duplicates by the redundancy pass instead.
- Date granularity: timestamps embedded in memory text use `[YYYY-MM-DD HH:MM:SS]` format for better temporal resolution.
- Consolidation log clarity: each operation now logs the full source memories and the resulting merged/resolved text.
- UI: user selector in sidebar with dropdown of known users, `localStorage` persistence, per-user session filtering.
- API: `GET /api/users`, `DELETE /api/sessions?userId=` endpoints added.

**Observed limitations:**
- Confidence calibration is inconsistent with the 8B model — past-continuous constructions like "I've been stressed" are sometimes rated high instead of medium. Accepted: low-stakes, doesn't affect correctness.
- Emotional pattern observation fires on retrieved memories from the *previous* state (e.g. fires "Stress pattern" even when the current message says things improved). The LLM handles this gracefully since it has the full context, but a future pass could filter observations against the current message's sentiment.
- The contradiction pass's single-pass processed-set means only one pair per cluster gets resolved per consolidation run — stale memories from a 3-way contradiction cluster can survive one cycle. Resolves on the next run.

---

## ~~Phase 3: Proactive Pattern Recognition~~ ✓

**Goal:** Surface meta-patterns in memories so the LLM can reason about the user, not just recall facts.

- **Recurrence detection:** Broad query fetches top-12 memories; if 4+ are returned, an LLM call produces a meta-observation injected into the system prompt for that turn only (not stored as a memory).
- **Emotional tone patterns:** Keyword gate (stress/anxiety/overwhelm/excited/frustrated/etc.) on candidate memories; if triggered, an LLM call produces an emotional-pattern observation injected into the system prompt.
- **Contradiction surfacing:** Decided against explicit surfacing — contradictions are resolved by the consolidation pass, and injected memories naturally provide both sides of a conflict when both are retrieved, letting the LLM reason about them contextually. This is less intrusive than explicit surfacing.
- Observations are one-shot per turn: injected into the system prompt only, never stored as memories, never re-surfaced next turn.

---

## Phase 4: Memory Types (Episodic, Semantic, Procedural, Goals)

**Goal:** Replace the flat fact list with typed memories that have different retrieval and injection strategies.

- **Semantic** (current behavior): Timeless facts. Retrieved by similarity to current message. Injected into user message context.
- **Episodic**: Timestamped events. *"On 2026-03-15, user was stressed about a job interview."* Retrieved by recency or event similarity. Enables *"last time you were in this situation..."* Note: basic date-based querying is already covered by the `[YYYY-MM-DD]` tag embedded in every memory text — this phase adds a distinct episodic type with its own index and richer recency-based retrieval strategy.
- **Procedural**: Behavioral preferences about the LLM itself. *"User prefers concise answers."* Always injected into the system prompt, not the message.
- **Goals/intentions**: Forward-looking facts. *"User wants to finish their novel by end of year."* Injected when the topic touches on planning or progress.
- Each type needs its own metadata schema, injection logic, and potentially its own vector index.
- Extraction prompt (Phase 3) needs to classify each new memory by type.

---

## Phase 5: Tool Use — Web Search & File Reading

**Goal:** Give the LLM agency to actively gather information beyond the conversation: fetch a web page by URL, or read and summarise a local file. Both are implemented as standard tool calls so the model decides when to use them.

### llama-server `--jinja` flag

- `setup_llm.ps1` already passes `config.llm.extraArgs` to `llama-server`.
- Add `"--jinja"` to `config.json`'s `llm.extraArgs` field. This flag enables Jinja2 chat-template processing, required for tool call formatting on models like Qwen3. No script changes needed.

### Tool call loop — `src/llm.js` + `src/pipeline/articulate.js`

The current flow sends one request and streams the result. With tools, the response may be a `tool_calls` object instead of text content. The new loop:

1. Send messages + tools list to `/v1/chat/completions` (non-streaming).
2. If response contains `tool_calls`: execute each tool, append `{ role: "tool", content: result }` messages, loop back to step 1.
3. Once the model returns a plain text response, stream it to the client as today.

Changes:
- `llm.js`: add `completeWithTools(messages, tools, options)` — handles the non-streaming tool-call turns and returns the final messages array ready for streaming.
- `articulate.js`: pass tools list to `completeWithTools`, then stream the final response once all tool calls are resolved.

### Tool definitions — `src/tools/`

**`src/tools/webFetch.js`** — fetch a URL as Markdown

- Tool name: `web_fetch`
- Parameters: `{ url: string }`
- Fetches `https://r.jina.ai/<url>` (no API key required for public pages; Jina Reader returns clean Markdown).
- Returns the Markdown string, truncated to a configurable max length to stay within context.

**`src/tools/readFile.js`** — read and summarise a local file

- Tool name: `read_file`
- Parameters: `{ path: string, task: string }` — `task` is the LLM's description of what it wants to understand from the file.
- Implementation (hierarchical summarisation):
  1. Read the file in overlapping chunks (configurable `chunkSize` / `overlapSize` chars).
  2. For each chunk: call the LLM with a prompt that includes `task` as the relevance lens — *"Summarise only the parts of this chunk relevant to: `<task>`"*.
  3. Collect all chunk summaries.
  4. If only one summary, return it directly. Otherwise call the LLM once more to merge all chunk summaries into a final answer shaped by `task`.
- Returns the final summary string as the tool result.

**`src/tools/index.js`** — registry + dispatcher

- Exports `TOOLS` (OpenAI-format tool definitions array) for inclusion in LLM requests.
- Exports `callTool(name, args)` — routes `web_fetch` → `webFetch.js`, `read_file` → `readFile.js`. Throws on unknown tool name.

### Config additions (`config.json`)

```json
"tools": {
  "webFetch": { "maxChars": 12000 },
  "readFile": { "chunkSize": 3000, "overlapSize": 200 }
}
```
