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

## ~~Phase 4: Memory Types (Episodic, Semantic, Procedural, Goals)~~ ✓

**Goal:** Replace the flat fact list with typed memories that have different retrieval and injection strategies.

- **Semantic**: Timeless facts. Retrieved by similarity. Injected into user message context as before.
- **Episodic**: Timestamped events. Retrieved by similarity alongside semantic. Type stored in metadata; recency-based re-ranking is future work.
- **Procedural**: Behavioral preferences about the LLM. Always fetched via `listByType` and injected into the system prompt on every turn — no similarity threshold, no filter LLM call.
- **Goal**: Forward-looking intentions. Retrieved by similarity alongside semantic (surfaces when topic is relevant).
- `type` field stored in metadata; propagated through all consolidation passes (merge/resolve/abstract use source type).
- Classification: extraction prompt outputs `fact | confidence | type`; 8B model unreliable at distinguishing types so two code-level fallbacks added:
  - Procedural: keyword match on "responses/answers" + "prefers/wants"
  - Episodic: temporal markers in the user message ("last month", "X ago", "recently") + past-tense verb in extracted fact

**Observed limitations:**
- Goal type is classified correctly by the model when stated clearly ("I want to…") but mislabeled as semantic when phrased indirectly. Functionally harmless — goals surface by similarity regardless of type label.
- Episodic recency-based retrieval not yet implemented — episodic memories retrieve identically to semantic. The `[YYYY-MM-DD HH:MM:SS]` timestamp in the text lets the LLM reason about recency already.
- No separate vector index per type — all types share one index per user. Simple enough for current memory counts; worth revisiting if procedural/goal lists grow large.

---

## ~~Phase 5: Tool Use — Web Search & File Reading~~ ✓

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

**Implementation note:** Tool calls handled inline in the streaming response rather than a separate non-streaming pre-pass. `streamOrToolCalls` in `llm.js` accumulates `delta.tool_calls` fragments during streaming; on completion with `finish_reason: tool_calls`, executes tools and starts a new streaming pass. No extra LLM call on turns where no tools are used.

---

## ~~Phase 6: Proactivity — Session Openers & Goal Tracking~~ ✓

**Goal:** Make the system feel temporally continuous — sessions feel connected, and goals stay top of mind without the user having to re-state them.

- **Session opener:** `POST /api/sessions/:id/open` SSE endpoint. On new session creation, fetches goals + recent episodic memories, computes days since last session, asks the LLM to generate a casual 1-2 sentence opening. Skips gracefully if no memories exist.
- **Stale goal surfacing:** In `recognize.js`, goals not accessed (retrieved by similarity) in >7 days are injected as observations each turn. The model decides whether to mention them based on conversational context.
- **Interaction:** Goals retrieved by similarity have their `lastAccessed` bumped, so they don't double-surface as stale. The two mechanisms are complementary — similarity retrieval handles relevant turns, staleness handles unrelated turns.

---

## ~~Phase 7: Temporal Grounding & File System Tools~~ ✓

**Goal:** Give the model reliable temporal context and the ability to read/write the local filesystem within a safe boundary.

### Timestamp injection

Every user message's `llmContent` is prefixed with `[YYYY-MM-DD HH:MM:SS]` at pipeline time. The model can now interpret relative time references ("today", "next month", "last week") correctly across all turns.

### File system tools (`src/tools/fileSystem.js`)

Three new tools, all path-guarded against `config.tools.fileSystem.allowedRoot`:

- **`list_directory`** — lists files and subdirectories at a given path
- **`write_file`** — writes text content to a file, creating parent directories as needed
- **`create_directory`** — creates a directory tree

Path security: all inputs are resolved with `path.resolve()` and validated to start with the allowed root before any file operation. Access outside the root throws immediately.

Config addition:
```json
"fileSystem": { "allowedRoot": "C:\\mind\\workspace" }
```

---

## ~~Phase 8: Narrative Synthesis — Living User Model~~ ✓

**Goal:** Replace per-turn memory injection (discrete facts) with a maintained, holistic model of the user that captures identity, context, and trajectory. The model should feel like it *knows* you, not just that it recalls facts about you.

### Approach

Maintain a `userModel.md` file per user (stored in `dataDir`) — a free-form prose document summarising who the user is: background, ongoing situation, personality, recurring themes, active goals. This is not a memory — it's a synthesis.

A background synthesis pass runs periodically (e.g. every N new memories, or at session end when memories were extracted). It reads the current user model + all recent memories since the last synthesis, and asks the LLM to produce an updated model document.

The user model is injected into the system prompt on every turn as a dedicated section — more compact than 3 individual memory snippets, more coherent, less dependent on retrieval luck.

**Key decisions:**
- User model is LLM-written and LLM-maintained — no structured schema, just prose
- Synthesis prompt receives: current model + new memories since last update
- Model is versioned by timestamp; old versions discarded (the synthesis is the canonical record)
- Retrieval-based injection continues alongside — user model covers broad identity, retrieval covers specific facts

---

## ~~Phase 9: Proactive Briefing~~ ✓

**Goal:** Let the user request a daily briefing that synthesizes calendar, email, goals, and user model into a focused summary — surfacing what's relevant, what needs attention, and connections between them.

### Approach

A **Briefing button** in the chat header triggers an on-demand pipeline (not automatic — fully user-controlled). When clicked:

1. Fetch next 7 days of calendar events via `get_calendar_events`
2. Fetch recent important mail via `search_mail({ query: 'is:important newer_than:7d' })`
3. Load active `goal`-type memories + user model for context
4. Single LLM synthesis call: highlight notable calendar events (especially those connected to goals), surface actionable emails (skip promotions), note connections between events/mail/goals
5. Stream result as an assistant message, save to session

The button respects the `busy` flag and is disabled when no session is open. Result is saved in session history.

**Deliberate design choices:**
- On-demand rather than automatic — the user decides when they want a briefing
- No scheduling complexity — the "once per day" feel is natural since you'd only click it when sitting down
- Can be re-run mid-day for a refresh
- Gracefully degrades if Google auth is expired (shows error in briefing text)

---

## ~~Phase 10: Calendar & Mail Integration~~ ✓

**Goal:** Give the model read access to the user's real-world schedule and inbox so it can reason about upcoming events, deadlines, and relevant messages without the user having to relay them manually.

### Calendar

Google Calendar API (REST, OAuth2). Scopes: `calendar.readonly` or the narrower `calendar.events.readonly`. Provides: event list, free/busy, recurring events. Practical as a tool call — `get_calendar_events({ days: 7 })` returns upcoming events as structured text. Useful for proactive research (Phase 9) and session openers.

### Mail

Google Gmail API (REST, OAuth2). Read-only scope: `gmail.readonly`. Returns message list, subjects, snippets, full body. For personal/local use, OAuth credentials from Google Cloud Console work without app verification — no public deployment required. Implement as a tool: `search_mail({ query: 'from:...' })` following Gmail's search syntax. Return subject + snippet, not full body by default (token cost).

### Auth

Both APIs use the same OAuth2 flow. Store refresh token locally (outside repo). A one-time browser-based consent flow (`gcloud`-style) generates the token. All subsequent calls use the refresh token silently.

### Privacy note

Mail content never leaves the local machine — it goes LLM → local llama-server only. The OAuth token should be stored in a path referenced by config, not committed.

---

## ~~Phase 11: Text-to-Speech & Sound Wave Visualisation~~ ✓

**Goal:** Let the model speak responses aloud using a locally-run TTS engine, with a live waveform visualised in the client while audio plays.

### TTS engine

Run locally — options include `piper` (fast, good quality, GGUF-adjacent ecosystem) or `kokoro` (higher quality, more resource-intensive). Output: WAV/PCM streamed or written to a temp file. The server plays or streams audio; the client visualises it.

### Server side

After articulation, pipe the response text to the TTS process. Stream PCM audio back to the client over a dedicated SSE or WebSocket channel, or serve it as a streamable audio endpoint.

### Client side

Use the Web Audio API: decode the incoming PCM stream into an `AudioBuffer`, play via `AudioContext`, and feed the analyser node to a `<canvas>` waveform renderer. The waveform animates in real time as audio plays — a visualisation of the model "speaking."

### Config

TTS is opt-in — a toggle in the UI and a `tts.enabled` flag in config. Binary path and model path follow the same pattern as the LLM config.

---

## ~~Phase 12: Server Activity Visualisation~~ ✓

**Goal:** Make the client show what the server is actually doing between the user sending a message and the response appearing — retrieval, recognition, tool calls, extraction — so the system feels transparent and alive rather than a black box.

### Approach

Emit structured status events over the existing SSE chat stream alongside `chunk` and `done` events. Each pipeline phase broadcasts a `status` event:

```json
{ "type": "status", "phase": "retrieve", "detail": "searching memories..." }
{ "type": "status", "phase": "tool_call", "detail": "web_search: best hiking trails Stockholm" }
{ "type": "status", "phase": "extract", "detail": "storing 2 memories" }
```

The client renders these as a transient activity strip above the streaming response bubble — phases appear and fade as they complete, tool calls show the tool name and query. Nothing is permanently added to the chat history; it's ephemeral UI feedback only.

### What gets surfaced

- Memory retrieval (how many candidates, how many injected)
- Pattern recognition firing (recurrence / emotional / stale goal)
- Each tool call: name + key argument (query, url, path)
- Memory extraction results (how many stored)
- Consolidation running

This is also useful for debugging — gives the same signal as watching server logs but in the UI.

---

## Phase 13: Episodic Re-ranking

**Goal:** Make episodic memory retrieval time-aware, so recent events rank higher than old ones when both are semantically similar.

### Approach

After cosine similarity scoring, apply a recency multiplier to episodic memories only:

```
adjusted_score = cosine_score * recency_weight(createdAt)
recency_weight = 0.5 + 0.5 * exp(-decay * age_in_days)
```

A configurable `decay` constant (e.g. 0.05) gives a half-life of ~14 days — a memory from yesterday scores nearly full weight, one from 6 months ago scores ~50%. Semantic/procedural/goal memories are unaffected (timeless facts shouldn't decay).

Apply the multiplier in `queryMemories` after fetching raw results, before sorting and slicing to `topK`.

Config addition: `memory.episodicDecay` (default 0.05).

---

## Phase 14: Memory & User Model Editing

**Goal:** Let the user correct, delete, or edit individual memories and the user model portrait directly from the UI — so bad extractions don't persist until consolidation resolves them.

### Memory editing (search modal)

- Add edit (✎) and delete (✕) buttons to each search result row
- **Delete:** `DELETE /api/memories/:id` — removes the item from the vector index by ID
- **Edit:** inline text edit; on save, calls `PUT /api/memories/:id` with new text — re-embeds and replaces the item, preserving metadata (confidence, type, dates)
- IDs must be returned alongside each search result (already available from vectra)

### User model editing (user model modal)

- Make the text in the user model modal editable (contenteditable or textarea toggle)
- Save button calls `PUT /api/usermodel?userId=` — writes the edited text directly to the `usermodel-{userId}.txt` file
- Useful when synthesis produces a wrong inference or misses important context

---

## Phase 15: Additional Tool Integrations

**Goal:** Extend the model's real-world reach with low-friction tools that follow the same pattern as calendar and mail.

### Weather — `get_weather` (zero friction)

- API: `open-meteo.com` — free, no key, no account
- Parameters: `{ lat, lon, days }` — returns current conditions + N-day forecast as structured text
- Config: `tools.weather.lat`, `tools.weather.lon` (set once, matches user's location)
- Utility: daily briefings, event planning, "should I ride my bike today?" decisions
- Implementation: one fetch call, ~30 lines

### Spotify — `get_recently_played`, `get_top_artists`, `get_currently_playing`

- Auth: Authorization Code OAuth flow — same pattern as Google. One-time browser consent. Requires a free Spotify Developer app (client ID + secret).
- Scopes: `user-read-recently-played`, `user-top-read`, `user-read-currently-playing` (all read-only)
- Tools:
  - `get_recently_played({ limit })` — last N tracks with timestamps
  - `get_top_artists({ timeRange })` — short (4 weeks) / medium (6 months) / long-term taste profile
  - `get_currently_playing` — active track, artist, progress
- Utility: listening history as mood/energy context in briefings ("you've been on a lot of heavy metal this week"); top artists are genuinely personal facts worth storing in the user model; "what should I listen to while working on X?" becomes answerable
- Implementation: same fetch + token refresh pattern as Google auth (~same file size as googleCalendar.js)

### Google Tasks — `list_tasks`, `create_task` (already authenticated)

- Auth: same OAuth token already in place — just add `tasks` to the scope list
- Provides the user's actual to-do lists, complementing the goal memory type
- Read + write: model can create tasks when the user asks it to, or surface overdue ones in briefings
- Utility: closes the loop between "I want to do X" (goal memory) and actual task management

### Ranking

1. **Weather** — zero setup, immediate briefing value
2. **Google Tasks** — already authenticated (just add scope), closes the loop between goal memories and real task management
3. **Spotify** — one-time OAuth setup, adds mood/listening context to briefings and user model

### Briefing integration

Once these tools are available, the briefing pipeline should use all of them together for richer daily context:

1. Weather for the week (`get_weather`)
2. Calendar events (`get_calendar_events`)
3. Important mail (`search_mail`)
4. Open/overdue tasks (`list_tasks`)
5. Top news of the day — `web_fetch` a public news feed (RSS/Atom or JSON API, no key required), extract headlines + summaries, ask the LLM to pick and summarise the most significant stories
6. Active goals from memory
7. Recent listening as mood signal (`get_recently_played` — optional, if Spotify configured)
8. User model for context

The LLM synthesis call should surface connections across all sources: a calendar event + related task + relevant weather in one note; a goal with an overdue task blocking it; a news story relevant to a goal or upcoming event; etc.

---

## Phase 16: Two-Way Communication via Google Tasks

**Goal:** Let the system push information and reminders back to the user through Google Tasks — turning the assistant from a pull-only system into one that can proactively reach the user outside of active sessions.

### Concept

The assistant already reads tasks and creates them on request. The next step is *autonomous* task creation: when the pipeline detects something worth surfacing (a stale goal, an upcoming deadline, a connection between a calendar event and an unfinished task), it writes a task to a dedicated list (e.g. "mindful") so the user sees it in their normal task workflow even when the app isn't open.

### Possible uses

- Stale goal surfacing: if a goal hasn't been discussed in >14 days and has no related open task, auto-create a reminder task
- Briefing follow-ups: after a briefing, create tasks for any actionable items the model identified
- Calendar prep: N days before an event connected to a known goal, create a prep task

### Design questions to resolve

- Should autonomous task creation require explicit opt-in (config flag)?
- Dedicated task list ("mindful") vs. writing to the user's default list?
- Risk of noise: the model creating tasks the user didn't ask for could be annoying — needs a conservative trigger threshold

---

## Known Issues / TODOs
