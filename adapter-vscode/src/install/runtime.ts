import { chmod, cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { InstallLayout } from './paths.js';

export interface HooksManifest {
  hooks: {
    UserPromptSubmit: Array<{
      hooks: Array<{ type: string; command: string }>;
    }>;
    PreToolUse: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    PostToolUse: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
  };
}

/** 生成 hooks.json：所有 command 均为指向 plugin 内脚本的绝对路径。 */
export function renderHooksManifest(pluginRootAbs: string): HooksManifest {
  const scriptsDir = path.join(pluginRootAbs, 'scripts');
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: path.join(scriptsDir, 'user-prompt-submit.sh'),
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: 'Bash|runTerminalCommand',
          hooks: [
            {
              type: 'command',
              command: path.join(scriptsDir, 'pre-tool-use.sh'),
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash|runTerminalCommand',
          hooks: [
            {
              type: 'command',
              command: path.join(scriptsDir, 'post-tool-use.sh'),
            },
          ],
        },
      ],
    },
  };
}

/** 转义用于双引号 bash 字符串的路径片段。 */
function bashDoubleQuotedPath(absPath: string): string {
  return absPath
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"');
}

async function ensureSourcePathExists(targetPath: string, kind: 'directory' | 'file'): Promise<void> {
  try {
    const info = await stat(targetPath);
    if (kind === 'directory' && !info.isDirectory()) {
      throw new Error(`install source missing directory: ${targetPath}`);
    }
    if (kind === 'file' && !info.isFile()) {
      throw new Error(`install source missing file: ${targetPath}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`install source missing ${kind}: ${targetPath}`);
    }
    throw err;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export interface RuntimeFsDeps {
  rename: typeof rename;
}

const defaultRuntimeFsDeps: RuntimeFsDeps = {
  rename,
};

/**
 * 生成 run-hook.sh：`HOOK_CLI_JS` 固定为传入的绝对路径；缺失 CLI 文件时给出可读错误。
 */
export function renderRunHookScript(hookCliJsAbsPath: string): string {
  const safe = bashDoubleQuotedPath(hookCliJsAbsPath);
  return `#!/usr/bin/env bash
set -euo pipefail
HOOK_CLI_JS="${safe}"
if [[ ! -f "\${HOOK_CLI_JS}" ]]; then
  printf '%s\\n' "hook CLI 缺失: 期望文件 \${HOOK_CLI_JS}，请确认已复制 adapter-vscode dist。" >&2
  exit 1
fi
exec node "\${HOOK_CLI_JS}" "$@"
`;
}

/**
 * 在 runtime 根目录下创建 plugin 副本、复制 hook CLI（dist）、写入 run-hook.sh 与 hooks.json。
 */
export async function writeRuntimeFiles(options: {
  layout: InstallLayout;
  deps?: Partial<RuntimeFsDeps>;
}): Promise<void> {
  const { layout } = options;
  const deps: RuntimeFsDeps = {
    ...defaultRuntimeFsDeps,
    ...options.deps,
  };
  const sourcePluginDir = path.join(layout.repoRoot, 'plugin-vscode-hooks');
  const sourceAdapterDist = path.join(layout.repoRoot, 'adapter-vscode', 'dist');
  const sourceHookCliPath = path.join(sourceAdapterDist, 'hooks', 'cli.js');

  await ensureSourcePathExists(sourcePluginDir, 'directory');
  await ensureSourcePathExists(sourceAdapterDist, 'directory');
  await ensureSourcePathExists(sourceHookCliPath, 'file');

  await mkdir(layout.runtimeRoot, { recursive: true });
  const stageRoot = path.join(layout.runtimeRoot, `.staging-${process.pid}-${Date.now()}`);
  const stagePluginRoot = path.join(stageRoot, 'vscode-plugin');
  const stageHookCliRoot = path.join(stageRoot, 'hook-cli');
  const stageHookCliDistRoot = path.join(stageHookCliRoot, 'dist');
  const backupPluginRoot = path.join(layout.runtimeRoot, '.backup-vscode-plugin');
  const backupHookCliRoot = path.join(layout.runtimeRoot, '.backup-hook-cli');
  const hadExistingPluginRoot = await pathExists(layout.pluginRoot);
  const hadExistingHookCliRoot = await pathExists(layout.hookCliRoot);
  let pluginRootSwapped = false;
  let hookCliRootSwapped = false;

  try {
    await mkdir(stageRoot, { recursive: true });
    await cp(sourcePluginDir, stagePluginRoot, { recursive: true, force: true });
    await mkdir(stageHookCliRoot, { recursive: true });
    await cp(sourceAdapterDist, stageHookCliDistRoot, { recursive: true, force: true });

    const runHookPath = path.join(stagePluginRoot, 'scripts', 'run-hook.sh');
    await writeFile(runHookPath, renderRunHookScript(layout.hookCliPath), 'utf8');
    await chmod(runHookPath, 0o755);

    const manifest = renderHooksManifest(layout.pluginRoot);
    await writeFile(
      path.join(stagePluginRoot, 'hooks', 'hooks.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    await rm(backupPluginRoot, { recursive: true, force: true });
    await rm(backupHookCliRoot, { recursive: true, force: true });

    if (hadExistingPluginRoot) {
      await deps.rename(layout.pluginRoot, backupPluginRoot);
    }
    if (hadExistingHookCliRoot) {
      await deps.rename(layout.hookCliRoot, backupHookCliRoot);
    }

    await deps.rename(stagePluginRoot, layout.pluginRoot);
    pluginRootSwapped = true;
    await deps.rename(stageHookCliRoot, layout.hookCliRoot);
    hookCliRootSwapped = true;

    await rm(backupPluginRoot, { recursive: true, force: true });
    await rm(backupHookCliRoot, { recursive: true, force: true });
  } catch (err) {
    if (pluginRootSwapped) {
      await rm(layout.pluginRoot, { recursive: true, force: true });
    }
    if (hookCliRootSwapped) {
      await rm(layout.hookCliRoot, { recursive: true, force: true });
    }
    await rm(stagePluginRoot, { recursive: true, force: true });
    await rm(stageHookCliRoot, { recursive: true, force: true });

    if (hadExistingPluginRoot && (await pathExists(backupPluginRoot))) {
      await rm(layout.pluginRoot, { recursive: true, force: true });
      await deps.rename(backupPluginRoot, layout.pluginRoot);
    }
    if (hadExistingHookCliRoot && (await pathExists(backupHookCliRoot))) {
      await rm(layout.hookCliRoot, { recursive: true, force: true });
      await deps.rename(backupHookCliRoot, layout.hookCliRoot);
    }

    throw err;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
    await rm(backupPluginRoot, { recursive: true, force: true });
    await rm(backupHookCliRoot, { recursive: true, force: true });
  }
}
