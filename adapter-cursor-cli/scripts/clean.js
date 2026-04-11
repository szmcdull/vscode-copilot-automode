import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(scriptDir, '..');
const targets = new Set(process.argv.slice(2));

if (targets.has('dist')) {
  rmSync(path.join(adapterRoot, 'dist'), { recursive: true, force: true });
}
