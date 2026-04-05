import { mkdir, mkdtemp, readFile, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInstallApply, runInstallPrepare } from './cli.js';
import { resolveInstallLayout } from './paths.js';

describe('runInstallPrepare', () => {
  let tmpBase: string | undefined;

  async function createMinimalRepoFixture(repoRoot: string): Promise<void> {
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'scripts'), { recursive: true });
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'hooks'), { recursive: true });
    await mkdir(path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'plugin.json'),
      '{"name":"auto-mode-plugin"}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'hooks', 'hooks.json'),
      '{"hooks":{}}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks', 'cli.js'),
      'console.log("hook cli");\n',
      'utf8',
    );
  }

  afterEach(async () => {
    if (tmpBase) {
      await rm(tmpBase, { recursive: true, force: true });
      tmpBase = undefined;
    }
  });

  it('读取带注释和尾随逗号的 settings.json(JSONC) 并完成合并写回', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-cli-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const homeDir = path.join(tmpBase, 'home');
    const settingsPath = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');

    await createMinimalRepoFixture(repoRoot);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      `{
  // existing comment
  "editor.fontSize": 14,
  "chat.pluginLocations": {
    "/keep": false,
  },
}
`,
      'utf8',
    );

    const layout = resolveInstallLayout({
      repoRoot,
      homedir: homeDir,
      platform: 'linux',
    });

    await runInstallPrepare({ layout });

    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(saved['editor.fontSize']).toBe(14);
    expect(saved['chat.plugins.enabled']).toBe(true);
    expect(saved['chat.pluginLocations']).toEqual({
      '/keep': false,
      [layout.pluginRoot]: true,
    });
  });

  it('settings.json 顶层不是对象时失败且不覆写原文件', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-cli-invalid-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const homeDir = path.join(tmpBase, 'home');
    const settingsPath = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
    await createMinimalRepoFixture(repoRoot);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, '[]\n', 'utf8');

    const layout = resolveInstallLayout({
      repoRoot,
      homedir: homeDir,
      platform: 'linux',
    });

    await expect(runInstallPrepare({ layout })).rejects.toThrow(/object|对象/i);
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe('[]\n');
  });

  it('通过临时文件与 rename 原子写回 settings.json', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-cli-atomic-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const homeDir = path.join(tmpBase, 'home');
    const settingsPath = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
    await createMinimalRepoFixture(repoRoot);

    const layout = resolveInstallLayout({
      repoRoot,
      homedir: homeDir,
      platform: 'linux',
    });

    const writes: string[] = [];
    const renames: Array<{ from: string; to: string }> = [];

    await runInstallPrepare({
      layout,
      deps: {
        mkdir,
        readFile,
        async writeFile(filePath, data, encoding) {
          writes.push(filePath);
          return writeFile(filePath, data, encoding);
        },
        async rename(from, to) {
          renames.push({ from, to });
          return fsRename(from, to);
        },
      } as never,
    });

    expect(writes).not.toContain(settingsPath);
    expect(renames).toHaveLength(1);
    expect(renames[0]?.to).toBe(settingsPath);
    expect(renames[0]?.from).not.toBe(settingsPath);
  });
});

describe('runInstallApply', () => {
  let tmpBase: string | undefined;

  afterEach(async () => {
    if (tmpBase) {
      await rm(tmpBase, { recursive: true, force: true });
      tmpBase = undefined;
    }
  });

  it('runs install VSIX before prepare (runtime + settings write)', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-apply-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const homeDir = path.join(tmpBase, 'home');
    const settingsPath = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
    const vsixPath = path.join(repoRoot, '.artifacts', 'auto-mode.vsix');

    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'scripts'), { recursive: true });
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'hooks'), { recursive: true });
    await mkdir(path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks'), { recursive: true });
    await mkdir(path.dirname(vsixPath), { recursive: true });
    await writeFile(vsixPath, 'fake vsix', 'utf8');

    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'plugin.json'),
      '{"name":"auto-mode-plugin"}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'hooks', 'hooks.json'),
      '{"hooks":{}}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks', 'cli.js'),
      'console.log("hook cli");\n',
      'utf8',
    );

    const layout = resolveInstallLayout({
      repoRoot,
      homedir: homeDir,
      platform: 'linux',
    });

    const order: string[] = [];

    await runInstallApply({
      layout,
      deps: {
        installVsix: async (p) => {
          order.push(`vsix:${p}`);
        },
        readFile: async (filePath, enc) => {
          if (filePath === settingsPath) {
            order.push('readFile:settings');
          }
          return readFile(filePath, enc);
        },
        writeFile: async (filePath, data, enc) => {
          if (filePath !== settingsPath && filePath.startsWith(path.dirname(settingsPath))) {
            order.push('writeFile:settings-temp');
          }
          return writeFile(filePath, data, enc);
        },
        rename: async (from, to) => {
          if (to === settingsPath) {
            order.push('rename:settings');
          }
          return fsRename(from, to);
        },
        mkdir,
      },
    });

    const vsixIdx = order.findIndex((e) => e.startsWith('vsix:'));
    const writeIdx = order.indexOf('rename:settings');
    expect(vsixIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(vsixIdx).toBeLessThan(writeIdx);
    expect(order[0]).toMatch(/^vsix:/);
    expect(order[0]).toContain(vsixPath);
  });
});
