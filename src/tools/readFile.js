import fs from 'fs';
import path from 'path';
import { chunkSummarize } from './chunkSummarize.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:readFile] ${label}`, data ?? '');
}

export async function readFile({ path: filePath, task, keywords }, context = {}) {
  const resolved = path.resolve(filePath);
  log('read', resolved);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return `Error reading file: file not found: ${resolved}`;
  }
  if (!stat.isFile()) return `Error: not a file: ${resolved}`;

  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
  if (!text) return 'File is empty.';

  // Record mtime in session cache so write_file can verify it was read
  if (context.session) {
    if (!context.session.fileCache) context.session.fileCache = {};
    context.session.fileCache[resolved] = stat.mtimeMs;
    log('cached-mtime', `${resolved} → ${stat.mtimeMs}`);
  }

  return await chunkSummarize(text, task, keywords ?? []);
}
