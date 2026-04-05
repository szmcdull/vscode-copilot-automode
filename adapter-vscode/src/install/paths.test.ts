import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInstallLayout, resolveVscodeUserSettingsPath } from './paths.js';

describe('resolveInstallLayout', () => {
  it('解析仓库根、vsix、运行时、插件目录、hook CLI 与 Linux 下 VS Code 用户 settings 路径', () => {
    const repoRoot = '/tmp/repo';
    const layout = resolveInstallLayout({
      repoRoot,
      homedir: '/home/u',
      platform: 'linux',
    });

    expect(layout.repoRoot).toBe(repoRoot);
    expect(layout.vsixPath).toBe(path.join(repoRoot, '.artifacts', 'auto-mode.vsix'));
    expect(layout.runtimeRoot).toBe(path.join('/home/u', '.auto-mode'));
    expect(layout.pluginRoot).toBe(path.join('/home/u', '.auto-mode', 'vscode-plugin'));
    expect(layout.hookCliRoot).toBe(path.join('/home/u', '.auto-mode', 'hook-cli'));
    expect(layout.hookCliPath).toBe(
      path.join('/home/u', '.auto-mode', 'hook-cli', 'dist', 'hooks', 'cli.js'),
    );
    expect(layout.vscodeSettingsPath).toBe(path.join('/home/u', '.config', 'Code', 'User', 'settings.json'));
  });

  it('允许覆盖 runtimeRoot', () => {
    const layout = resolveInstallLayout({
      repoRoot: '/r',
      runtimeRoot: '/custom/runtime',
      homedir: '/h',
      platform: 'linux',
    });
    expect(layout.runtimeRoot).toBe('/custom/runtime');
    expect(layout.pluginRoot).toBe(path.join('/custom/runtime', 'vscode-plugin'));
    expect(layout.hookCliRoot).toBe(path.join('/custom/runtime', 'hook-cli'));
    expect(layout.hookCliPath).toBe(path.join('/custom/runtime', 'hook-cli', 'dist', 'hooks', 'cli.js'));
  });
});

describe('resolveVscodeUserSettingsPath', () => {
  it('Linux 使用 ~/.config/Code/User/settings.json', () => {
    expect(
      resolveVscodeUserSettingsPath({ homedir: '/home/x', platform: 'linux' }),
    ).toBe('/home/x/.config/Code/User/settings.json');
  });
});
