# mindful

## Project Overview

A system for managing coherent context for locally-run LLMs, across context limits and across sessions.

**Vision:** Enable users to develop a deep, one-way relationship with a local LLM (prioritizing privacy), which in turn enables richer, more personalized discussions since the LLM will accumulate knowledge about the user over time.

## How It Works

**Problem:** Local LLMs have a fixed context window and no persistence between sessions.

**Solution:** Two complementary mechanisms:
1. **Summarization** — Conversation history beyond the context horizon is summarized and compressed, preserving meaning without consuming token budget.
2. **Memory retrieval** — Relevant memories are stored in a vector DB and loaded into context on demand, so the LLM can recall facts about the user across sessions.

## Architecture

```
Client (HTML/CSS/JS)
       |
Chat Server (Express)          ← handles LLM ↔ client communication
       |
Core Context System (Node.js)  ← context management layer
       |          |
  Summarizer   Vector DB (Vectra)
       |
  LLM Server (llama.cpp)   Embedding Server (llama.cpp)
```

### Core Context System
- **Input:** Full chat history (as the user sees it in the client)
- **Output:** Managed chat that fits within the context window, infused with relevant memories retrieved from the vector DB

### Chat Server
- Sits between the client and the LLM
- Delegates context management to the Core Context System before forwarding messages to the LLM

## Stack

- **Runtime:** Node.js
- **Vector DB:** Vectra (local)
- **Server:** Express
- **Frontend:** HTML, CSS, vanilla JS
- **LLM backend:** llama.cpp (via HTTP API)

## Config (`config.json`)

| Key | Description |
|-----|-------------|
| `llm.serverHost` | Host where llama-server runs |
| `llm.port` | llama-server port (default 8080) |
| `llm.model` | Path to the GGUF model file |
| `llm.contextSize` | Token context window size |
| `embedding.port` | Embedding server port (default 8081) |
| `embedding.model` | Path to the embedding model (nomic-embed-text) |
| `embedding.contextSize` | Embedding model context size |
