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
  const now = Date.now();
  await index.insertItem({ vector, metadata: { text, createdAt: now, lastAccessed: now, accessCount: 0 } });
}

export async function queryMemories(text, topK) {
  const vector = await embed(text);
  const results = await index.queryItems(vector, topK);
  const minScore = config.memory.minSimilarity ?? 0.35;
  const hits = results.filter(r => r.score >= minScore);

  if (hits.length > 0) {
    const now = Date.now();
    await index.beginUpdate();
    for (const r of hits) {
      await index.upsertItem({
        id: r.item.id,
        vector: r.item.vector,
        metadata: {
          ...r.item.metadata,
          lastAccessed: now,
          accessCount: (r.item.metadata.accessCount ?? 0) + 1
        }
      });
    }
    await index.endUpdate();
  }

  return hits.map(r => r.item.metadata.text);
}

export async function listAllMemories() {
  const items = await index.listItems();
  return items.map(i => i.metadata.text).filter(Boolean);
}

export async function listAllItems() {
  return await index.listItems();
}

export async function deleteItems(ids) {
  await index.beginUpdate();
  for (const id of ids) {
    await index.deleteItem(id);
  }
  await index.endUpdate();
}

export async function replaceItems(ids, newText) {
  await deleteItems(ids);
  await addMemory(newText);
}

export async function searchMemories(text, topK) {
  const vector = await embed(text);
  const results = await index.queryItems(vector, topK);
  return results.map(r => ({ text: r.item.metadata.text, score: r.score }));
}

export async function wipeMemories() {
  const indexPath = path.join(config.dataDir, 'memories');
  fs.rmSync(indexPath, { recursive: true, force: true });
  await index.createIndex();
}
