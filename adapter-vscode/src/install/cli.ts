import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InstallLayout } from './paths.js';
import { resolveInstallLayout } from './paths.js';
import { writeRuntimeFiles } from './runtime.js';
import { mergeVscodeSettings } from './settings.js';

export interface InstallCliDeps {
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  rename: typeof rename;
}

export interface RunInstallApplyDeps extends InstallCliDeps {
  installVsix: (vsixPath: string) => Promise<void>;
}

export interface RunInstallApplyOptions {
  layout: InstallLayout;
  deps?: Partial<RunInstallApplyDeps>;
}

const defaultDeps: InstallCliDeps = {
  readFile,
  writeFile,
  mkdir,
  rename,
};

function stripJsoncComments(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) {
        j += 1;
      }
      if (input[j] === '}' || input[j] === ']') {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function parseJsoncObject(raw: string): Record<string, unknown> {
  const sanitized = stripTrailingCommas(stripJsoncComments(raw));
  const parsed: unknown = JSON.parse(sanitized);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error('VS Code settings.json top-level must be an object');
}

async function readOrCreateSettingsJson(
  filePath: string,
  deps: InstallCliDeps,
): Promise<Record<string, unknown>> {
  try {
    const raw = await deps.readFile(filePath, 'utf8');
    return parseJsoncObject(raw);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export interface RunInstallPrepareOptions {
  layout: InstallLayout;
  deps?: Partial<InstallCliDeps>;
}

async function writeSettingsJsonAtomically(
  settingsPath: string,
  value: Record<string, unknown>,
  deps: InstallCliDeps,
): Promise<void> {
  await deps.mkdir(path.dirname(settingsPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(settingsPath),
    `.${path.basename(settingsPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await deps.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await deps.rename(tempPath, settingsPath);
}

/**
 * 读取/创建 VS Code 用户 settings、生成运行时文件、合并 chat 插件相关键并写回 settings。
 * （后续可由 Task 2 接入 `code --install-extension` 等编排。）
 */
export async function runInstallPrepare(options: RunInstallPrepareOptions): Promise<void> {
  const deps: InstallCliDeps = { ...defaultDeps, ...options.deps };
  const { layout } = options;
  const settingsPath = layout.vscodeSettingsPath;

  const existing = await readOrCreateSettingsJson(settingsPath, deps);
  await writeRuntimeFiles({ layout });

  const merged = mergeVscodeSettings(existing, path.resolve(layout.pluginRoot));
  await writeSettingsJsonAtomically(settingsPath, merged, deps);
}

async function defaultInstallVsix(vsixPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('code', ['--install-extension', vsixPath], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`code --install-extension exited with code ${code ?? signal ?? 'unknown'}`));
      }
    });
  });
}

/**
 * 先安装 VSIX，再执行 prepare（运行时副本与 settings 合并写回）。
 * 供一键安装脚本在 build/package 之后调用；`installVsix` 可注入以便测试。
 */
export async function runInstallApply(options: RunInstallApplyOptions): Promise<void> {
  const merged: RunInstallApplyDeps = {
    ...defaultDeps,
    installVsix: defaultInstallVsix,
    ...options.deps,
  };
  const { installVsix, ...prepareDeps } = merged;
  await installVsix(options.layout.vsixPath);
  await runInstallPrepare({ layout: options.layout, deps: prepareDeps });
}

/** 解析仓库根：优先 `REPO_ROOT`；否则若 cwd 为 `adapter-vscode` 则取其父目录，否则视为 cwd。 */
export function resolveRepoRootForInstallCli(): string {
  if (process.env.REPO_ROOT) {
    return path.resolve(process.env.REPO_ROOT);
  }
  const cwd = process.cwd();
  if (path.basename(cwd) === 'adapter-vscode') {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRootForInstallCli();
  const layout = resolveInstallLayout({ repoRoot });
  await runInstallApply({ layout });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
