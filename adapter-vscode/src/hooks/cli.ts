import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { stdin } from 'node:process';
import { createBridgeManifestStore } from '../bridge/manifest.js';
import { normalizeWorkspaceKey } from '../bridge/runtimePaths.js';
import { appendDebugLog, summarizeHookPayload } from '../debug/log.js';
import {
  assertPostToolUsePayload,
  assertPreToolUsePayload,
  assertUserPromptSubmitPayload,
  type BridgeHookClient,
  type HookCliDeps,
} from './types.js';

class BridgeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'BridgeUnavailableError';
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface RunHookCliOnceOptions {
  argv: string[];
  rawPayload: string;
  deps?: HookCliDeps;
  write?: (output: string) => void;
}

export function createHookCli(deps: HookCliDeps) {
  return {
    async run(hookEventName: string, payload: unknown) {
      switch (hookEventName) {
        case 'UserPromptSubmit':
          return deps.userPromptSubmit(assertUserPromptSubmitPayload(payload));
        case 'PreToolUse':
          return deps.preToolUse(assertPreToolUsePayload(payload));
        case 'PostToolUse':
          return deps.postToolUse(assertPostToolUsePayload(payload));
        default:
          throw new Error(`unsupported hook event: ${hookEventName}`);
      }
    },
  };
}

export interface CreateHookCliDepsFromBridgeOptions {
  bridgeClient: BridgeHookClient;
  /** Workspace key used for manifest lookup / logging (forwarded payloads already carry `cwd`). */
  workspaceKey: string;
}

/**
 * Thin hook composition: validate payloads and forward hook events to the extension-host bridge.
 * The bridge resolves `ask` via extension-owned UI before returning a final host `allow` / `deny`.
 */
export function createHookCliDepsFromBridge(options: CreateHookCliDepsFromBridgeOptions): HookCliDeps {
  void options.workspaceKey;

  return {
    userPromptSubmit: async (payload) =>
      options.bridgeClient.invoke('UserPromptSubmit', assertUserPromptSubmitPayload(payload)),
    preToolUse: async (payload) =>
      options.bridgeClient.invoke('PreToolUse', assertPreToolUsePayload(payload)),
    postToolUse: async (payload) =>
      options.bridgeClient.invoke('PostToolUse', assertPostToolUsePayload(payload)),
  };
}

export interface CreateBridgeHttpClientOptions {
  port: number;
  token: string;
  fetchImpl?: typeof fetch;
}

export function createBridgeHttpClient(options: CreateBridgeHttpClientOptions): BridgeHookClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = `http://127.0.0.1:${options.port}`;

  return {
    async invoke(event: string, payload: unknown): Promise<unknown> {
      await appendDebugLog({
        component: 'hook-cli',
        event: 'bridge_invoke_start',
        details: {
          hookEventName: event,
          port: options.port,
          payload: summarizeHookPayload(payload),
        },
      }).catch(() => undefined);

      const body = {
        hookEventName: event,
        payload: { ...(payload as Record<string, unknown>), token: options.token },
      };

      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/bridge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (error: unknown) {
        await appendDebugLog({
          component: 'hook-cli',
          event: 'bridge_invoke_failure',
          details: {
            hookEventName: event,
            port: options.port,
            message: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => undefined);
        throw new BridgeUnavailableError(
          `bridge request failed before receiving a response: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }

      if (!res.ok) {
        const textBody = await res.text().catch(() => '');
        await appendDebugLog({
          component: 'hook-cli',
          event: 'bridge_invoke_failure',
          details: {
            hookEventName: event,
            port: options.port,
            status: res.status,
            body: textBody,
          },
        }).catch(() => undefined);
        throw new Error(`bridge request failed (${res.status}): ${textBody}`);
      }

      const parsed = (await res.json()) as unknown;
      await appendDebugLog({
        component: 'hook-cli',
        event: 'bridge_invoke_success',
        details: {
          hookEventName: event,
          port: options.port,
        },
      }).catch(() => undefined);
      return parsed;
    },
  };
}

function hookRuntimeRootFromEnv(env: NodeJS.ProcessEnv): string {
  const runtimeRootRaw = env.AUTO_MODE_HOOK_RUNTIME_ROOT?.trim();
  return runtimeRootRaw && runtimeRootRaw.length > 0
    ? runtimeRootRaw
    : path.join(tmpdir(), 'auto-mode-hook-runtime');
}

function workspaceKeyFromHookPayload(hookEventName: string, payload: unknown): string | undefined {
  if (
    hookEventName !== 'UserPromptSubmit' &&
    hookEventName !== 'PreToolUse' &&
    hookEventName !== 'PostToolUse'
  ) {
    return undefined;
  }

  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const cwd = (payload as Record<string, unknown>).cwd;
  return typeof cwd === 'string' ? cwd : undefined;
}

export async function resolveHookCliDepsFromPayload(
  hookEventName: string,
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HookCliDeps> {
  const runtimeRoot = hookRuntimeRootFromEnv(env);
  const manifestStore = createBridgeManifestStore({ rootDir: runtimeRoot });
  const cwd = workspaceKeyFromHookPayload(hookEventName, payload);
  await appendDebugLog({
    component: 'hook-cli',
    event: 'resolve_deps_start',
    details: {
      hookEventName,
      runtimeRoot,
      cwd,
      payload: summarizeHookPayload(payload),
    },
  }).catch(() => undefined);
  if (cwd) {
    const manifest = await manifestStore.getClosest(normalizeWorkspaceKey(cwd));
    if (manifest) {
      const workspaceKey = manifest.workspaceKey;
      await appendDebugLog({
        component: 'hook-cli',
        event: 'manifest_hit',
        details: {
          hookEventName,
          cwd,
          workspaceKey,
          port: manifest.port,
        },
      }).catch(() => undefined);
      const client = createBridgeHttpClient({ port: manifest.port, token: manifest.token });
      const bridgeDeps = createHookCliDepsFromBridge({ bridgeClient: client, workspaceKey });

      return {
        userPromptSubmit: async (hookPayload) =>
          invokeWithBridgeCleanup(() => bridgeDeps.userPromptSubmit(hookPayload), manifestStore, workspaceKey),
        preToolUse: async (hookPayload) =>
          invokeWithBridgeCleanup(() => bridgeDeps.preToolUse(hookPayload), manifestStore, workspaceKey),
        postToolUse: async (hookPayload) =>
          invokeWithBridgeCleanup(() => bridgeDeps.postToolUse(hookPayload), manifestStore, workspaceKey),
      };
    }
  }

  await appendDebugLog({
    component: 'hook-cli',
    event: 'manifest_miss_error',
    details: {
      hookEventName,
      cwd,
      runtimeRoot,
    },
  }).catch(() => undefined);
  throw new Error('bridge manifest not found; ensure the Auto Mode extension is running for this workspace');
}

async function invokeWithBridgeCleanup<T>(
  invokeBridge: () => Promise<T>,
  manifestStore: ReturnType<typeof createBridgeManifestStore>,
  workspaceKey: string,
): Promise<T> {
  try {
    return await invokeBridge();
  } catch (error: unknown) {
    if (!(error instanceof BridgeUnavailableError)) {
      throw error;
    }
    await appendDebugLog({
      component: 'hook-cli',
      event: 'bridge_cleanup_after_unavailable',
      details: {
        workspaceKey,
        message: error.message,
      },
    }).catch(() => undefined);
    await manifestStore.delete(workspaceKey).catch(() => undefined);
    throw error;
  }
}

async function createDefaultHookCliDeps(
  hookEventName: string,
  payload: unknown,
): Promise<HookCliDeps> {
  return resolveHookCliDepsFromPayload(hookEventName, payload, process.env);
}

export async function runHookCliOnce(options: RunHookCliOnceOptions): Promise<void> {
  const hookEventName = options.argv[2];
  if (!hookEventName) {
    throw new Error('missing hook event name (argv[2])');
  }

  let payload: unknown = {};
  if (options.rawPayload.trim() !== '') {
    try {
      payload = JSON.parse(options.rawPayload) as unknown;
    } catch {
      throw new Error('invalid hook payload JSON on stdin');
    }
  }

  await appendDebugLog({
    component: 'hook-cli',
    event: 'run_start',
    details: {
      hookEventName,
      payload: summarizeHookPayload(payload),
    },
  }).catch(() => undefined);

  const cli = createHookCli(
    options.deps ?? (await createDefaultHookCliDeps(hookEventName, payload)),
  );
  const result = await cli.run(hookEventName, payload);
  await appendDebugLog({
    component: 'hook-cli',
    event: 'run_complete',
    details: {
      hookEventName,
      resultType: typeof result,
    },
  }).catch(() => undefined);
  (options.write ?? process.stdout.write.bind(process.stdout))(`${JSON.stringify(result)}\n`);
}

/**
 * Reads hook name from argv, JSON payload from stdin, prints JSON result on stdout.
 * Used by `plugin-vscode-hooks/scripts/run-hook.sh`.
 */
export async function runHookCliFromStdin(): Promise<void> {
  const raw = await text(stdin);
  await runHookCliOnce({
    argv: process.argv,
    rawPayload: raw,
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runHookCliFromStdin().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
