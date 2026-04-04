import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import config from './config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tts] ${label}`, data ?? '');
}

export function isTTSConfigured() {
  return !!(config.tts?.binary && config.tts?.model);
}

// Strip markdown and other noise before sending to TTS
function cleanText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')       // bold
    .replace(/\*(.+?)\*/gs, '$1')            // italic
    .replace(/https?:\/\/\S+/g, '')          // URLs
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links
    .replace(/`{1,3}[^`]*`{1,3}/gs, '')      // inline + fenced code
    .replace(/^#{1,6}\s/gm, '')              // headings
    .replace(/\n{3,}/g, '\n\n')              // excess blank lines
    .trim();
}

export async function synthesize(text) {
  const binary = config.tts?.binary;
  const model = config.tts?.model;
  if (!binary || !model) throw new Error('TTS not configured (tts.binary and tts.model required in config.json)');

  const cleaned = cleanText(text);
  if (!cleaned) throw new Error('No speakable text after cleaning');

  const tmpFile = join(tmpdir(), `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  const t0 = Date.now();
  log('synthesize', `${cleaned.length} chars → ${tmpFile}`);

  await new Promise((resolve, reject) => {
    const proc = spawn(binary, ['--model', model, '--output_file', tmpFile], {
      stdio: ['pipe', 'ignore', 'ignore']
    });
    proc.stdin.write(cleaned, 'utf8');
    proc.stdin.end();
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  const buf = readFileSync(tmpFile);
  try { unlinkSync(tmpFile); } catch {}
  log('done', `${buf.length} bytes in ${Date.now() - t0}ms`);
  return buf;
}
