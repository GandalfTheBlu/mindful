import path from 'path';
import fs from 'fs';
import { LocalIndex } from 'vectra';
import { embed } from '../llm.js';
import config from '../config.js';

const index = new LocalIndex(path.join(config.dataDir, 'memories'));

export async function init() {
  if (!await index.isIndexCreated()) {
    await index.createIndex();
  }
}

export async function addMemory(text) {
  const vector = await embed(text);
  await index.insertItem({ vector, metadata: { text } });
}

export async function queryMemories(text, topK) {
  const vector = await embed(text);
  const results = await index.queryItems(vector, topK);
  const minScore = config.memory.minSimilarity ?? 0.35;
  return results
    .filter(r => r.score >= minScore)
    .map(r => r.item.metadata.text);
}

export async function listAllMemories() {
  const items = await index.listItems();
  return items.map(i => i.metadata.text).filter(Boolean);
}

export async function wipeMemories() {
  const indexPath = path.join(config.dataDir, 'memories');
  fs.rmSync(indexPath, { recursive: true, force: true });
  await index.createIndex();
}
