import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const autoModeRoot = path.resolve(here, '..', '..');
const pluginRoot = path.join(autoModeRoot, 'plugin-vscode-hooks');

const pluginManifest = JSON.parse(
  readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'),
) as Record<string, unknown>;

const hooksManifest = JSON.parse(
  readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'),
) as {
  hooks: Record<string, Array<Record<string, unknown>>>;
};

describe('plugin-vscode-hooks manifest', () => {
  it('declares the hooks manifest entrypoint', () => {
    expect(pluginManifest.hooks).toBe('./hooks/hooks.json');
  });

  it('uses repo-relative script paths so the plugin directory can move without machine-specific absolute paths', () => {
    expect(hooksManifest.hooks.UserPromptSubmit).toEqual([
      {
        hooks: [
          {
            type: 'command',
            command: './scripts/user-prompt-submit.sh',
          },
        ],
      },
    ]);

    expect(hooksManifest.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash|runTerminalCommand',
        hooks: [
          {
            type: 'command',
            command: './scripts/pre-tool-use.sh',
          },
        ],
      },
    ]);

    expect(hooksManifest.hooks.PostToolUse).toEqual([
      {
        matcher: 'Bash|runTerminalCommand',
        hooks: [
          {
            type: 'command',
            command: './scripts/post-tool-use.sh',
          },
        ],
      },
    ]);
  });
});
