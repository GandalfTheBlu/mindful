import fs from 'fs';
import { chunkSummarize } from './chunkSummarize.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:readFile] ${label}`, data ?? '');
}

export async function readFile({ path, task }) {
  log('read', path);
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
  if (!text) return 'File is empty.';
  return await chunkSummarize(text, task);
}
