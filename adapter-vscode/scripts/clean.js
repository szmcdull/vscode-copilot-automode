import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(scriptDir, '..');
const artifactsDir = path.resolve(adapterRoot, '..', '.artifacts');
const targets = new Set(process.argv.slice(2));

if (targets.has('dist')) {
  rmSync(path.join(adapterRoot, 'dist'), { recursive: true, force: true });
}

if (targets.has('vsix')) {
  for (const entry of readdirSync(adapterRoot)) {
    if (/\.vsix$/u.test(entry)) {
      rmSync(path.join(adapterRoot, entry), { force: true });
    }
  }
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
}
