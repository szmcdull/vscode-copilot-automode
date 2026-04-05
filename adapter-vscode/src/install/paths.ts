import os from 'node:os';
import path from 'node:path';

export interface InstallLayout {
  repoRoot: string;
  vsixPath: string;
  runtimeRoot: string;
  pluginRoot: string;
  hookCliRoot: string;
  hookCliPath: string;
  vscodeSettingsPath: string;
}

export interface ResolveInstallLayoutOptions {
  repoRoot: string;
  runtimeRoot?: string;
  homedir?: string;
  platform?: NodeJS.Platform;
}

/**
 * 解析一键安装使用的目录布局（vsix、运行时副本、Hook CLI 与 VS Code 用户 settings 路径）。
 */
export function resolveInstallLayout(options: ResolveInstallLayoutOptions): InstallLayout {
  const { repoRoot } = options;
  const homedir = options.homedir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const runtimeRoot = options.runtimeRoot ?? path.join(homedir, '.auto-mode');

  const vsixPath = path.join(repoRoot, '.artifacts', 'auto-mode.vsix');
  const pluginRoot = path.join(runtimeRoot, 'vscode-plugin');
  const hookCliRoot = path.join(runtimeRoot, 'hook-cli');
  const hookCliPath = path.join(hookCliRoot, 'dist', 'hooks', 'cli.js');
  const vscodeSettingsPath = resolveVscodeUserSettingsPath({ homedir, platform });

  return {
    repoRoot,
    vsixPath,
    runtimeRoot,
    pluginRoot,
    hookCliRoot,
    hookCliPath,
    vscodeSettingsPath,
  };
}

export interface ResolveVscodeUserSettingsPathOptions {
  homedir: string;
  platform: NodeJS.Platform;
}

/** VS Code 用户 settings.json 的绝对路径（按平台区分）。 */
export function resolveVscodeUserSettingsPath(options: ResolveVscodeUserSettingsPathOptions): string {
  const { homedir, platform } = options;
  if (platform === 'win32') {
    return path.join(homedir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  // linux 及其它类 Unix：~/.config/Code/User/settings.json
  return path.join(homedir, '.config', 'Code', 'User', 'settings.json');
}
