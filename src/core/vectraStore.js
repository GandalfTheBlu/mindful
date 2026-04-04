import path from 'path';
import fs from 'fs';
import { LocalIndex } from 'vectra';
import { embed } from '../llm.js';
import config from '../config.js';

const indexes = new Map();

function getIndexPath(userId) {
  return path.join(config.dataDir, `memories-${userId}`);
}

async function getIndex(userId) {
  if (!indexes.has(userId)) {
    const idx = new LocalIndex(getIndexPath(userId));
    if (!await idx.isIndexCreated()) {
      await idx.createIndex();
    }
    indexes.set(userId, idx);
  }
  return indexes.get(userId);
}

export async function init() {
  // Indexes are created on demand; nothing to pre-initialize.
}

export async function addMemory(userId, text) {
  const index = await getIndex(userId);
  const vector = await embed(text);
  const now = Date.now();
  await index.insertItem({ vector, metadata: { text, createdAt: now, lastAccessed: now, accessCount: 0 } });
}

export async function queryMemories(userId, text, topK) {
  const index = await getIndex(userId);
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

export async function listAllMemories(userId) {
  const index = await getIndex(userId);
  const items = await index.listItems();
  return items.map(i => i.metadata.text).filter(Boolean);
}

export async function listAllItems(userId) {
  const index = await getIndex(userId);
  return await index.listItems();
}

export async function deleteItems(userId, ids) {
  const index = await getIndex(userId);
  await index.beginUpdate();
  for (const id of ids) {
    await index.deleteItem(id);
  }
  await index.endUpdate();
}

export async function replaceItems(userId, ids, newText) {
  await deleteItems(userId, ids);
  await addMemory(userId, newText);
}

export async function searchMemories(userId, text, topK) {
  const index = await getIndex(userId);
  const vector = await embed(text);
  const results = await index.queryItems(vector, topK);
  return results.map(r => ({ text: r.item.metadata.text, score: r.score }));
}

export async function wipeMemories(userId) {
  const indexPath = getIndexPath(userId);
  fs.rmSync(indexPath, { recursive: true, force: true });
  indexes.delete(userId);
  await getIndex(userId);
}
