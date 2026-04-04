# mindful — Roadmap

## ~~Phase 1: Memory Lifecycle (Forgetting & Consolidation)~~ ✓

**Goal:** Prevent the vector store from bloating and degrading over time.

- Add `lastAccessed` and `accessCount` metadata to each memory. Update on every retrieval hit.
- **Decay pass:** Remove memories that have never been accessed and haven't been touched in a long time.
- **Redundancy pass:** Cluster memories by similarity (cosine > ~0.92). Ask the LLM to merge each cluster into a single canonical statement.
- **Contradiction pass:** Flag pairs that semantically contradict each other. Resolve by recency, or surface to the user.
- **Abstraction pass:** When N specific memories share a theme, replace them with a single generalization. Signal preserved, token cost reduced.
- Trigger: run consolidation at session end, or when memory count crosses a configurable threshold.

---

## Phase 2: Confidence-Weighted Memories

**Goal:** Stop treating all extracted memories as ground truth — weight them by how strongly they were asserted.

- Assign a confidence score at extraction time based on assertion strength:
  - High: explicit declarations ("I am a vegetarian"), or facts confirmed across multiple sessions
  - Medium: single hedged mention ("I'm kind of into hiking")
  - Low: inferred from subtext
- Low-confidence memories: deprioritized at injection time, expired faster in consolidation.
- **Validation loop:** When a topic recurs, compare new evidence against stored memory. Boost confidence on confirmation, drop on contradiction.
- Let the LLM hedge when surfacing low-confidence memories: *"I think you mentioned X — is that still the case?"*

---

## Phase 3: Proactive Pattern Recognition

**Goal:** Surface meta-patterns in memories so the LLM can reason about the user, not just recall facts.

- **Recurrence detection:** If memories cluster around a theme that has been raised 4+ times across sessions, inject a meta-observation into the system prompt for that turn.
- **Emotional tone patterns:** Track recurring themes of stress, uncertainty, enthusiasm, etc. Surface gently when directly relevant to the current message.
- **Contradiction surfacing:** Instead of silently resolving contradictions, let the LLM name them when contextually appropriate.
- Design constraint: proactive surfacing should only trigger when relevant to the current message — not on every turn. Consider making it opt-in.

---

## Phase 4: Memory Types (Episodic, Semantic, Procedural, Goals)

**Goal:** Replace the flat fact list with typed memories that have different retrieval and injection strategies.

- **Semantic** (current behavior): Timeless facts. Retrieved by similarity to current message. Injected into user message context.
- **Episodic**: Timestamped events. *"On 2026-03-15, user was stressed about a job interview."* Retrieved by recency or event similarity. Enables *"last time you were in this situation..."*
- **Procedural**: Behavioral preferences about the LLM itself. *"User prefers concise answers."* Always injected into the system prompt, not the message.
- **Goals/intentions**: Forward-looking facts. *"User wants to finish their novel by end of year."* Injected when the topic touches on planning or progress.
- Each type needs its own metadata schema, injection logic, and potentially its own vector index.
- Extraction prompt (Phase 3) needs to classify each new memory by type.
