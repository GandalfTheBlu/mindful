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

export async function addMemory(userId, text, confidence = 1.0, type = 'semantic') {
  const index = await getIndex(userId);
  const vector = await embed(text);
  const now = Date.now();
  await index.insertItem({ vector, metadata: { text, createdAt: now, lastAccessed: now, accessCount: 0, confidence, type } });
}

function episodicRecencyWeight(createdAt, decay) {
  const ageInDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return 0.5 + 0.5 * Math.exp(-decay * ageInDays);
}

export async function queryMemories(userId, text, topK) {
  const index = await getIndex(userId);
  const vector = await embed(text);
  // Fetch a wider candidate pool so episodic re-ranking can surface recent
  // items that cosine alone would have ranked below the topK cut.
  const fetchK = topK * 3;
  const results = await index.queryItems(vector, fetchK);
  const minScore = config.memory.minSimilarity ?? 0.35;
  const decay = config.memory.episodicDecay ?? 0.05;

  // Apply recency multiplier to episodic memories, leave others untouched.
  const ranked = results
    .map(r => {
      const isEpisodic = (r.item.metadata.type ?? 'semantic') === 'episodic';
      const adjustedScore = isEpisodic
        ? r.score * episodicRecencyWeight(r.item.metadata.createdAt ?? Date.now(), decay)
        : r.score;
      return { r, adjustedScore };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore)
    .slice(0, topK);

  const hits = ranked.filter(({ adjustedScore }) => adjustedScore >= minScore);

  if (hits.length > 0) {
    const now = Date.now();
    await index.beginUpdate();
    for (const { r } of hits) {
      const current = r.item.metadata.confidence ?? 1.0;
      await index.upsertItem({
        id: r.item.id,
        vector: r.item.vector,
        metadata: {
          ...r.item.metadata,
          lastAccessed: now,
          accessCount: (r.item.metadata.accessCount ?? 0) + 1,
          confidence: Math.min(1.0, current + (config.confidence?.boostOnAccess ?? 0.05))
        }
      });
    }
    await index.endUpdate();
  }

  return hits.map(({ r }) => ({ text: r.item.metadata.text, confidence: r.item.metadata.confidence ?? 1.0, type: r.item.metadata.type ?? 'semantic' }));
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

export async function listByType(userId, type) {
  const index = await getIndex(userId);
  const items = await index.listItems();
  return items
    .filter(i => (i.metadata.type ?? 'semantic') === type)
    .map(i => i.metadata.text)
    .filter(Boolean);
}

export async function listByTypeWithMeta(userId, type) {
  const index = await getIndex(userId);
  const items = await index.listItems();
  return items
    .filter(i => (i.metadata.type ?? 'semantic') === type && i.metadata.text)
    .map(i => ({
      text: i.metadata.text,
      createdAt: i.metadata.createdAt ?? 0,
      lastAccessed: i.metadata.lastAccessed ?? i.metadata.createdAt ?? 0
    }));
}

export async function replaceItems(userId, ids, newText, confidence = 1.0, type = 'semantic') {
  await deleteItems(userId, ids);
  await addMemory(userId, newText, confidence, type);
}

export async function searchMemories(userId, text, topK, type = null) {
  const index = await getIndex(userId);
  const vector = await embed(text);
  // Fetch more than needed so we can filter by type after scoring
  const fetchK = type ? topK * 4 : topK;
  const results = await index.queryItems(vector, fetchK);
  const filtered = type
    ? results.filter(r => (r.item.metadata.type ?? 'semantic') === type)
    : results;
  return filtered.slice(0, topK).map(r => ({
    text: r.item.metadata.text,
    score: r.score,
    type: r.item.metadata.type ?? 'semantic',
    confidence: r.item.metadata.confidence ?? 1.0,
    createdAt: r.item.metadata.createdAt ?? null,
    lastAccessed: r.item.metadata.lastAccessed ?? null,
    accessCount: r.item.metadata.accessCount ?? 0
  }));
}

export async function wipeMemories(userId) {
  const indexPath = getIndexPath(userId);
  fs.rmSync(indexPath, { recursive: true, force: true });
  indexes.delete(userId);
  await getIndex(userId);
}
