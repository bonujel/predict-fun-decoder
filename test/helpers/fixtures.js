import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HELPER_DIR, '..', '..', 'fixtures');

export function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), 'utf8'));
}
