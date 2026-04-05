import fs from 'fs';
import path from 'path';
import { complete } from '../llm.js';
import { listAllItems } from './vectraStore.js';
import config from '../config.js';

const SYNTHESIS_THRESHOLD = 5;

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [userModel] ${label}`, data ?? '');
}

function modelPath(userId) {
  return path.join(config.dataDir, `usermodel-${userId}.txt`);
}

function metaPath(userId) {
  return path.join(config.dataDir, `usermodel-${userId}.meta.json`);
}

export function getUserModel(userId) {
  const p = modelPath(userId);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim() || null;
}

// Extracts just the ## Summary section from the structured model.
export function getUserModelSummary(userId) {
  const full = getUserModel(userId);
  if (!full) return null;
  const match = full.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\s*$)/i);
  return match ? match[1].trim() : null;
}

export function setUserModel(userId, text) {
  fs.writeFileSync(modelPath(userId), text.trim(), 'utf8');
}

export function wipeUserModel(userId) {
  [modelPath(userId), metaPath(userId)].forEach(p => {
    try { fs.unlinkSync(p); } catch {}
  });
}

function saveUserModel(userId, text) {
  fs.writeFileSync(modelPath(userId), text, 'utf8');
}

function getLastSynthesisCount(userId) {
  const p = metaPath(userId);
  if (!fs.existsSync(p)) return 0;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).lastCount ?? 0;
  } catch { return 0; }
}

function saveLastSynthesisCount(userId, count) {
  fs.writeFileSync(metaPath(userId), JSON.stringify({ lastCount: count }), 'utf8');
}

const SYNTHESIS_SYSTEM = `/no_think
You are maintaining a structured profile of a user based on their stored memories. Produce a profile with exactly these sections. Each section (except Summary) contains short bullet points — 2 to 5 bullets, specific and concrete. Write in third person, present tense. Omit a section entirely if there is nothing relevant to put in it.

## Summary
2–3 sentences capturing who this person is, what they are doing, and what they are working toward. This is the only prose section.

## Background
Stable identity facts: location, profession, education, life context.

## Current Projects
What they are actively building, creating, or working on right now.

## Goals
Forward-looking intentions and aspirations.

## Interests
Domains, hobbies, communities, and activities they care about.

## Patterns
Recurring themes, habits, or tendencies observed across their memories.

If an existing profile is provided, update it with new information while preserving accurate existing content. Remove outdated or superseded details.`;

async function synthesize(userId, currentCount) {
  const items = await listAllItems(userId);
  if (items.length === 0) return;

  const memoryLines = items
    .map(i => i.metadata.text)
    .filter(Boolean)
    .map((t, idx) => `${idx + 1}. ${t}`)
    .join('\n');

  const existing = getUserModel(userId);
  const contextContent = [
    'Memories:',
    memoryLines,
    '',
    existing
      ? `Existing portrait (update this):\n${existing}`
      : 'No existing portrait. Write a new one.'
  ].join('\n');

  log('synthesizing', `${items.length} memories, existing=${!!existing}`);

  const result = await complete(
    [
      { role: 'system', content: SYNTHESIS_SYSTEM },
      { role: 'user', content: contextContent }
    ],
    { max_tokens: 600 }
  );

  const text = result.trim();
  if (text) {
    saveUserModel(userId, text);
    saveLastSynthesisCount(userId, currentCount);
    log('done', `${text.length} chars saved`);
  }
}

// Call after consolidation. Returns true if synthesis ran.
export async function maybeSynthesizeUserModel(userId, currentCount) {
  const lastCount = getLastSynthesisCount(userId);
  if (currentCount - lastCount < SYNTHESIS_THRESHOLD) return false;
  await synthesize(userId, currentCount);
  return true;
}
