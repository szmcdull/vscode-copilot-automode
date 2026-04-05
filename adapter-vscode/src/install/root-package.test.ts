import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('repo root package.json', () => {
  it('exposes install:vscode script', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const rootPkgPath = path.join(here, '..', '..', '..', 'package.json');
    const raw = await readFile(rootPkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.['install:vscode']).toBe('bash ./scripts/install-vscode.sh');
  });
});
