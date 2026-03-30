import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const config = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json'), 'utf8')
);

export default config;
