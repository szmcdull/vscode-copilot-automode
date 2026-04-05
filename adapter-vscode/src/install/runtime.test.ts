import { access, mkdir, mkdtemp, readFile, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInstallLayout } from './paths.js';
import { renderHooksManifest, renderRunHookScript, writeRuntimeFiles } from './runtime.js';

describe('renderHooksManifest', () => {
  it('command 为绝对路径且包含 UserPromptSubmit / PreToolUse / PostToolUse', () => {
    const pluginRoot = '/tmp/runtime/vscode-plugin';
    const manifest = renderHooksManifest(pluginRoot);

    const ups = manifest.hooks.UserPromptSubmit[0].hooks[0].command as string;
    const pre = manifest.hooks.PreToolUse[0].hooks[0].command as string;
    const post = manifest.hooks.PostToolUse[0].hooks[0].command as string;

    expect(path.isAbsolute(ups)).toBe(true);
    expect(path.isAbsolute(pre)).toBe(true);
    expect(path.isAbsolute(post)).toBe(true);
    expect(ups).toBe(path.join(pluginRoot, 'scripts', 'user-prompt-submit.sh'));
    expect(pre).toBe(path.join(pluginRoot, 'scripts', 'pre-tool-use.sh'));
    expect(post).toBe(path.join(pluginRoot, 'scripts', 'post-tool-use.sh'));
  });
});

describe('renderRunHookScript', () => {
  it('固定 HOOK_CLI_JS 为传入的绝对路径且缺失时有清晰报错', () => {
    const cliJs = '/abs/hooks/cli.js';
    const script = renderRunHookScript(cliJs);
    expect(script).toContain('HOOK_CLI_JS="/abs/hooks/cli.js"');
    expect(script).toMatch(/hook CLI|缺失|not found|missing/i);
    expect(script).toContain('exec node "${HOOK_CLI_JS}"');
  });

  it('会转义双引号字符串中的 $, 反引号与双引号，避免 shell 展开', () => {
    const cliJs = '/abs/$name`tick"/cli.js';
    const script = renderRunHookScript(cliJs);
    expect(script).toContain('HOOK_CLI_JS="/abs/\\$name\\`tick\\"/cli.js"');
  });
});

describe('writeRuntimeFiles', () => {
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
      path.join(repoRoot, 'plugin-vscode-hooks', 'scripts', 'run-hook.sh'),
      '#!/usr/bin/env bash\necho run\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'scripts', 'user-prompt-submit.sh'),
      '#!/usr/bin/env bash\necho user\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'scripts', 'pre-tool-use.sh'),
      '#!/usr/bin/env bash\necho pre\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'scripts', 'post-tool-use.sh'),
      '#!/usr/bin/env bash\necho post\n',
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

  it('创建目录、复制 plugin 与 dist、写入 run-hook.sh 与 hooks.json', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-install-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const runtimeRoot = path.join(tmpBase, '.auto-mode');
    await createMinimalRepoFixture(repoRoot);
    await mkdir(runtimeRoot, { recursive: true });

    const layout = resolveInstallLayout({
      repoRoot,
      runtimeRoot,
      homedir: '/h',
      platform: 'linux',
    });

    await writeRuntimeFiles({ layout });

    const runHook = await readFile(path.join(layout.pluginRoot, 'scripts', 'run-hook.sh'), 'utf8');
    expect(runHook).toContain(`HOOK_CLI_JS="${layout.hookCliPath}"`);

    const hooksJson = JSON.parse(
      await readFile(path.join(layout.pluginRoot, 'hooks', 'hooks.json'), 'utf8'),
    ) as ReturnType<typeof renderHooksManifest>;
    expect(hooksJson.hooks.UserPromptSubmit[0].hooks[0].command).toContain(layout.pluginRoot);

    const cliJs = await readFile(layout.hookCliPath, 'utf8');
    expect(cliJs.length).toBeGreaterThan(0);

    const pluginJson = await readFile(path.join(layout.pluginRoot, 'plugin.json'), 'utf8');
    expect(pluginJson).toContain('auto-mode-plugin');
    expect(layout.pluginRoot).toBe(path.join(runtimeRoot, 'vscode-plugin'));
    expect(layout.hookCliRoot).toBe(path.join(runtimeRoot, 'hook-cli'));
    expect(layout.hookCliPath).toBe(path.join(runtimeRoot, 'hook-cli', 'dist', 'hooks', 'cli.js'));
  });

  it('源目录或 hook CLI 缺失时失败且不留下半更新的 runtime 目录', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-install-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const runtimeRoot = path.join(tmpBase, '.auto-mode');
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'scripts'), { recursive: true });
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'hooks'), { recursive: true });
    await writeFile(path.join(repoRoot, 'plugin-vscode-hooks', 'plugin.json'), '{"name":"auto-mode-plugin"}\n', 'utf8');
    await writeFile(path.join(repoRoot, 'plugin-vscode-hooks', 'hooks', 'hooks.json'), '{"hooks":{}}\n', 'utf8');

    const layout = resolveInstallLayout({
      repoRoot,
      runtimeRoot,
      homedir: '/h',
      platform: 'linux',
    });

    await expect(writeRuntimeFiles({ layout })).rejects.toThrow(/missing|缺失|source/i);
    await expect(access(layout.pluginRoot)).rejects.toThrow();
    await expect(access(layout.hookCliRoot)).rejects.toThrow();
  });

  it('第二步切换失败时会清理已落位的新目录，并恢复旧 runtime 到一致状态', async () => {
    tmpBase = await mkdtemp(path.join(os.tmpdir(), 'auto-mode-install-'));
    const repoRoot = path.join(tmpBase, 'repo');
    const runtimeRoot = path.join(tmpBase, '.auto-mode');

    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'scripts'), { recursive: true });
    await mkdir(path.join(repoRoot, 'plugin-vscode-hooks', 'hooks'), { recursive: true });
    await mkdir(path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks'), { recursive: true });
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'plugin.json'),
      '{"name":"new-plugin"}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'hooks', 'hooks.json'),
      '{"hooks":{}}\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'plugin-vscode-hooks', 'scripts', 'run-hook.sh'),
      '#!/usr/bin/env bash\necho new\n',
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, 'adapter-vscode', 'dist', 'hooks', 'cli.js'),
      'console.log("new cli");\n',
      'utf8',
    );

    const layout = resolveInstallLayout({
      repoRoot,
      runtimeRoot,
      homedir: '/h',
      platform: 'linux',
    });

    await mkdir(path.join(layout.pluginRoot, 'scripts'), { recursive: true });
    await mkdir(path.join(layout.hookCliRoot, 'dist', 'hooks'), { recursive: true });
    await writeFile(path.join(layout.pluginRoot, 'plugin.json'), '{"name":"old-plugin"}\n', 'utf8');
    await writeFile(
      path.join(layout.pluginRoot, 'scripts', 'run-hook.sh'),
      '#!/usr/bin/env bash\necho old\n',
      'utf8',
    );
    await writeFile(path.join(layout.hookCliRoot, 'dist', 'hooks', 'cli.js'), 'console.log("old cli");\n', 'utf8');

    let injectedFailureHit = false;
    await expect(
      writeRuntimeFiles({
        layout,
        deps: {
          async rename(from, to) {
            if (from.includes('.staging-') && to === layout.hookCliRoot) {
              injectedFailureHit = true;
              throw new Error('injected rename failure');
            }
            await fsRename(from, to);
          },
        },
      } as never),
    ).rejects.toThrow('injected rename failure');

    expect(injectedFailureHit).toBe(true);
    expect(await readFile(path.join(layout.pluginRoot, 'plugin.json'), 'utf8')).toContain('old-plugin');
    expect(await readFile(path.join(layout.hookCliRoot, 'dist', 'hooks', 'cli.js'), 'utf8')).toContain('old cli');
    await expect(access(path.join(runtimeRoot, '.backup-vscode-plugin'))).rejects.toThrow();
    await expect(access(path.join(runtimeRoot, '.backup-hook-cli'))).rejects.toThrow();
  });
});
