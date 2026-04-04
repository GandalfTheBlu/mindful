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

export async function listDirectory({ path: dirPath }, context = {}) {
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

  // Record this directory as listed for this turn
  if (context.listedDirs) context.listedDirs.add(resolved);
  log('entries', lines.length);
  return lines.join('\n') || '(empty directory)';
}

export async function writeFile({ path: filePath, content }, context = {}) {
  const resolved = guardPath(filePath);
  const parentDir = path.dirname(resolved);

  // Guard: parent must have been listed in this turn
  if (context.listedDirs && !context.listedDirs.has(parentDir)) {
    return `Error: you must list the parent directory before writing to it. Call list_directory("${parentDir}") first.`;
  }

  // Guard: if file exists, it must have been read this turn (mtime must match cache)
  if (fs.existsSync(resolved)) {
    const currentMtime = fs.statSync(resolved).mtimeMs;
    const cachedMtime = context.session?.fileCache?.[resolved];
    if (cachedMtime === undefined) {
      return `Error: "${resolved}" already exists and has not been read this turn. Call read_file first so you know its current contents before overwriting.`;
    }
    if (cachedMtime !== currentMtime) {
      return `Error: "${resolved}" has been modified externally since it was last read (cached mtime: ${cachedMtime}, current: ${currentMtime}). Call read_file again to get the latest version.`;
    }
  }

  log('write', resolved);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');

  // Update cache with new mtime after write
  const newMtime = fs.statSync(resolved).mtimeMs;
  if (context.session) {
    if (!context.session.fileCache) context.session.fileCache = {};
    context.session.fileCache[resolved] = newMtime;
  }

  log('done', `${content.length} chars written`);
  return `File written: ${resolved}`;
}

export async function createDirectory({ path: dirPath }, context = {}) {
  const resolved = guardPath(dirPath);
  const parentDir = path.dirname(resolved);

  // Guard: parent must have been listed in this turn (unless it's the root itself)
  if (resolved !== getAllowedRoot() && context.listedDirs && !context.listedDirs.has(parentDir)) {
    return `Error: you must list the parent directory before creating a subdirectory in it. Call list_directory("${parentDir}") first.`;
  }

  // Guard: do not silently overwrite an existing directory
  if (fs.existsSync(resolved)) {
    return `Error: directory already exists: ${resolved}`;
  }

  log('mkdir', resolved);
  fs.mkdirSync(resolved, { recursive: true });
  log('done', resolved);
  return `Directory created: ${resolved}`;
}
