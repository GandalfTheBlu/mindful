import fs from 'fs';
import path from 'path';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:fileSystem] ${label}`, data ?? '');
}

function getAllowedRoot() {
  const root = config.tools?.fileSystem?.allowedRoot;
  if (!root) throw new Error('fileSystem tool requires tools.fileSystem.allowedRoot in config.json');
  return path.resolve(root);
}

function guardPath(target) {
  const allowedRoot = getAllowedRoot();
  const resolved = path.resolve(target);
  if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
    throw new Error(`Access denied: path is outside allowed root (${allowedRoot})`);
  }
  return resolved;
}

export async function listDirectory({ path: dirPath }) {
  const resolved = guardPath(dirPath);
  log('list', resolved);
  if (!fs.existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const lines = entries.map(e => {
    const indicator = e.isDirectory() ? '/' : e.isSymbolicLink() ? '@' : '';
    return `${e.name}${indicator}`;
  });
  log('entries', lines.length);
  return lines.join('\n') || '(empty directory)';
}

export async function writeFile({ path: filePath, content }) {
  const resolved = guardPath(filePath);
  log('write', resolved);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');
  log('done', `${content.length} chars written`);
  return `File written: ${resolved}`;
}

export async function createDirectory({ path: dirPath }) {
  const resolved = guardPath(dirPath);
  log('mkdir', resolved);
  fs.mkdirSync(resolved, { recursive: true });
  log('done', resolved);
  return `Directory created: ${resolved}`;
}
