import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { AskChallenge, ReviewDecision, UserAction, SourceKind } from './protocol/types.js';
import type { ShellInterceptEvent } from './interceptors/shellInterceptor.js';
import type { ExtensionContext, Disposable } from 'vscode';
import { createBridgeManifestStore } from './bridge/manifest.js';
import type { BridgeManifest, BridgeManifestStore } from './bridge/manifest.js';
import { normalizeWorkspaceKey } from './bridge/runtimePaths.js';
import { createBridgeServer, type BridgeServer } from './bridge/server.js';
import { createShellInterceptor } from './interceptors/shellInterceptor.js';
import { readModelConfig } from './model/config.js';
import { createShellCommandEntry, type ShellCommandEntry } from './host/shellEntry.js';
import { createUiController, type UiController } from './host/ui.js';
import { createPostToolUseHandler } from './hooks/postToolUse.js';
import { RUN_IN_TERMINAL_TOOL_NAME } from './hooks/preToolUse.js';
import { createSessionStore } from './hooks/sessionStore.js';
import { createToolUseLinkStore } from './hooks/toolUseLinkStore.js';
import {
  assertPostToolUsePayload,
  assertPreToolUsePayload,
  assertUserPromptSubmitPayload,
} from './hooks/types.js';
import { createUserPromptSubmitHandler } from './hooks/userPromptSubmit.js';
import { appendDebugLog, debugLogPathFromEnv } from './debug/log.js';
import { createModelClient } from './model/clientFactory.js';
import { createReviewEngine, type ShellReviewResult } from './review/reviewEngine.js';
import type {
  Phase1ReviewResult,
  Phase2ResolvedAccessReviewInput,
  Phase2ReviewResult,
  ShellReviewInput,
} from './review/reviewPrompt.js';
import { resolvePhase1Accesses as defaultResolvePhase1Accesses } from './review/resolvedAccessResolver.js';
import type { ResolvePhase1AccessesInput, ResolvePhase1AccessesResult } from './review/resolvedAccessResolver.js';
import { createShellQuarantineStore, type ShellQuarantineStore } from './review/shellQuarantineStore.js';

export interface AdapterBundleConfig {
  reviewEngine: {
    reviewShellCommand(input: {
      userPrompt: string;
      command: string;
      workspaceRoot: string;
      homeDir: string;
      cwd: string;
    }): Promise<{
      finalAction: 'allow' | 'deny' | 'ask';
      reason: string;
    }>;
  };
  source?: SourceKind;
}

export interface ShellExecutionResult {
  request: ReturnType<ReturnType<typeof createShellInterceptor>['intercept']>['request'];
  finalDecision: ReviewDecision;
  finalDecisionSource:
    | 'local_model'
    | 'local_user_decision'
    | 'runtime_constraint';
  execution: {
    action: 'execute' | 'deny';
    requestId: string;
    trace: ReviewDecision['trace'];
  };
}

export interface HandleShellInterceptionOptions {
  promptUser?: (challenge: AskChallenge) => Promise<UserAction> | UserAction;
}

export interface ExtensionRuntime {
  adapterBundle: ReturnType<typeof createAdapterBundle>;
}

export interface ActivateDependencies {
  getConfigValue: (key: string) => unknown;
  createUi: () => UiController;
  startHookBridgeHost: (options: StartHookBridgeHostOptions) => Promise<void>;
  createShellEntry: (options: {
    adapterBundle: ReturnType<typeof createAdapterBundle>;
    ui: UiController;
  }) => ShellCommandEntry;
  registerCommand: (
    command: string,
    handler: () => unknown | Promise<unknown>,
  ) => DisposableLike;
  /** Default loads real `vscode`; tests inject a stub so `activate` does not import the runtime package. */
  loadVscodeModule?: () => Promise<typeof import('vscode')>;
}

interface DisposableLike {
  dispose(): void;
}

export interface StartHookBridgeHostOptions {
  getConfigValue: (key: string) => unknown;
  ui: UiController;
  reviewEngine: ReturnType<typeof createReviewEngine>;
}

export interface BridgeRuntimeHandle {
  dispose(): Promise<void>;
}

export async function registerBridgeManifest(options: {
  manifestStore: Pick<BridgeManifestStore, 'put' | 'delete'>;
  manifest: BridgeManifest;
  closeServer: () => Promise<void>;
}): Promise<BridgeRuntimeHandle> {
  try {
    await options.manifestStore.put(options.manifest);
  } catch (error) {
    await options.manifestStore.delete(options.manifest.workspaceKey).catch(() => undefined);
    await options.closeServer().catch(() => undefined);
    throw error;
  }

  return {
    async dispose() {
      try {
        await options.closeServer();
      } finally {
        await options.manifestStore.delete(options.manifest.workspaceKey).catch(() => undefined);
      }
    },
  };
}

export async function replaceBridgeRuntime(options: {
  previousDispose?: () => Promise<void>;
  nextRuntime: BridgeRuntimeHandle;
}): Promise<() => Promise<void>> {
  const nextDispose = () => options.nextRuntime.dispose();

  if (!options.previousDispose) {
    return nextDispose;
  }

  try {
    await options.previousDispose();
    return nextDispose;
  } catch (error) {
    await nextDispose().catch(() => undefined);
    throw error;
  }
}

export type ResolvePhase1AccessesFn = (
  input: ResolvePhase1AccessesInput,
) => Promise<ResolvePhase1AccessesResult>;

/** Hook bridge uses phase 1 + resolver (+ phase 2 when needed); `reviewShellCommand` remains for other callers. */
export interface HookBridgeReviewEngine {
  reviewPhase1ShellCommand(input: ShellReviewInput): Promise<Phase1ReviewResult>;
  reviewPhase2ResolvedAccesses(input: Phase2ResolvedAccessReviewInput): Promise<Phase2ReviewResult>;
  reviewShellCommand(input: ShellReviewInput): Promise<ShellReviewResult>;
}

export interface CreateExtensionHookBridgeOptions {
  hookRuntimeRoot: string;
  workspaceRoot: string;
  reviewEngine: HookBridgeReviewEngine;
  ui: Pick<UiController, 'promptPreToolUseDecision' | 'showAskResolved'>;
  token?: string;
  homeDir?: string;
  resolvePhase1Accesses?: ResolvePhase1AccessesFn;
  shellQuarantine?: ShellQuarantineStore;
  /** When false, `run_in_terminal` PreToolUse is allowed without phase1/2 review (settings: `autoMode.enabled`). */
  isHookReviewEnabled?: () => boolean;
}

let activeBridgeDispose: (() => Promise<void>) | undefined;

async function readHttpBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function listenBridgeHttpServer(bridge: BridgeServer): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/bridge') {
      res.writeHead(404).end();
      return;
    }

    try {
      const raw = await readHttpBody(req);
      const parsed = JSON.parse(raw) as { hookEventName?: string; payload?: unknown };
      await appendDebugLog({
        component: 'extension-bridge',
        event: 'http_request_received',
        details: {
          hookEventName: parsed.hookEventName,
        },
      }).catch(() => undefined);
      if (typeof parsed.hookEventName !== 'string' || parsed.payload === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'expected hookEventName and payload' }));
        return;
      }

      const result = await bridge.handle(parsed.hookEventName, parsed.payload);
      await appendDebugLog({
        component: 'extension-bridge',
        event: 'http_request_success',
        details: {
          hookEventName: parsed.hookEventName,
        },
      }).catch(() => undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog({
        component: 'extension-bridge',
        event: 'http_request_failure',
        details: {
          message,
        },
      }).catch(() => undefined);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        void appendDebugLog({
          component: 'extension-bridge',
          event: 'http_listen_ready',
          details: {
            port: addr.port,
          },
        }).catch(() => undefined);
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((e) => (e ? rej(e) : res()));
            }),
        });
      } else {
        reject(new Error('bridge listen failed'));
      }
    });
    server.on('error', reject);
  });
}

/**
 * `run_in_terminal` on the hook bridge now uses the two-phase realpath review flow.
 * Keep the command-palette path (`createAdapterBundle`) on legacy single-phase review
 * until that caller is migrated intentionally.
 */
export function createExtensionHookBridge(options: CreateExtensionHookBridgeOptions): {
  bridge: BridgeServer;
  token: string;
} {
  const sessionStore = createSessionStore({ rootDir: options.hookRuntimeRoot });
  const linkStore = createToolUseLinkStore({ rootDir: options.hookRuntimeRoot });
  const token = options.token ?? randomUUID();
  const shellQuarantine = options.shellQuarantine ?? createShellQuarantineStore();
  const resolveAccesses = options.resolvePhase1Accesses ?? defaultResolvePhase1Accesses;

  const preToolUse = async (payload: unknown) => {
    const p = assertPreToolUsePayload(payload);
    await appendDebugLog({
      component: 'extension-bridge',
      event: 'pre_tool_use_received',
      details: {
        tool_name: p.tool_name,
        session_id: p.session_id,
        tool_use_id: p.tool_use_id,
        cwd: p.cwd,
      },
    }).catch(() => undefined);
    if (p.tool_name !== RUN_IN_TERMINAL_TOOL_NAME) {
      await appendDebugLog({
        component: 'extension-bridge',
        event: 'pre_tool_use_passthrough',
        details: {
          tool_name: p.tool_name,
        },
      }).catch(() => undefined);
      return { continue: true };
    }

    const hookReviewEnabled = options.isHookReviewEnabled?.() ?? true;
    if (!hookReviewEnabled) {
      await appendDebugLog({
        component: 'extension-bridge',
        event: 'pre_tool_use_hook_review_disabled',
        details: {
          session_id: p.session_id,
          tool_use_id: p.tool_use_id,
        },
      }).catch(() => undefined);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason:
            'Auto Mode hook review is disabled (autoMode.enabled=false); shell not reviewed by the extension.',
        },
      };
    }

    const quarantineKey = { sessionId: p.session_id, workspaceRoot: options.workspaceRoot };
    if (shellQuarantine.isQuarantined(quarantineKey)) {
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Shell execution is locked for this session due to repeated denials; commands are not sent to the review model.',
        },
      };
    }

    const promptContext = await sessionStore.get(p.session_id);
    const command = typeof p.tool_input.command === 'string' ? p.tool_input.command : '';

    const phase1 = await options.reviewEngine.reviewPhase1ShellCommand({
      userPrompt: promptContext?.prompt ?? '',
      command,
      workspaceRoot: options.workspaceRoot,
      homeDir: options.homeDir ?? homedir(),
      cwd: p.cwd,
    });
    await appendDebugLog({
      component: 'extension-bridge',
      event: 'phase1_review_complete',
      details: {
        allow: phase1.allow,
        complete: phase1.complete,
        reason: phase1.reason,
        command,
      },
    }).catch(() => undefined);

    if (!phase1.allow || !phase1.complete) {
      shellQuarantine.recordDeny(quarantineKey, 'phase1');
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: phase1.reason,
        },
      };
    }

    const resolved = await resolveAccesses({
      cwd: p.cwd,
      accesses: phase1.accesses,
    });
    await appendDebugLog({
      component: 'extension-bridge',
      event: 'resolve_phase1_accesses_complete',
      details: {
        ok: resolved.ok,
        needsPhase2: resolved.needsPhase2,
        command,
      },
    }).catch(() => undefined);

    if (!resolved.ok) {
      shellQuarantine.recordDeny(quarantineKey, 'resolve');
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: resolved.reason ?? 'local path resolution failed',
        },
      };
    }

    if (!resolved.needsPhase2) {
      shellQuarantine.clearDenyStreak(quarantineKey);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: phase1.reason,
        },
      };
    }

    const phase2 = await options.reviewEngine.reviewPhase2ResolvedAccesses({
      cmd: command,
      cwd: p.cwd,
      complete: 'y',
      accesses: resolved.accesses,
    });
    await appendDebugLog({
      component: 'extension-bridge',
      event: 'phase2_review_complete',
      details: {
        allow: phase2.allow,
        reason: phase2.reason,
        command,
      },
    }).catch(() => undefined);

    if (!phase2.allow) {
      shellQuarantine.recordDeny(quarantineKey, 'phase2');
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: phase2.reason,
        },
      };
    }

    shellQuarantine.clearDenyStreak(quarantineKey);
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: phase2.reason,
      },
    };
  };

  const userPromptSubmitHandler = createUserPromptSubmitHandler(sessionStore);
  const postToolUseHandler = createPostToolUseHandler({
    linkStore,
  });

  return {
    token,
    bridge: createBridgeServer({
      token,
      handlers: {
        userPromptSubmit: async (payload: unknown) =>
          userPromptSubmitHandler(assertUserPromptSubmitPayload(payload)),
        preToolUse,
        postToolUse: async (payload: unknown) => postToolUseHandler(assertPostToolUsePayload(payload)),
      },
    }),
  };
}

export async function startHookBridgeHost(options: StartHookBridgeHostOptions): Promise<void> {
  const vscode = await import('vscode');
  const hookRuntimeRoot =
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT?.trim() || path.join(tmpdir(), 'auto-mode-hook-runtime');
  await appendDebugLog({
    component: 'extension',
    event: 'start_hook_bridge_host',
    details: {
      hookRuntimeRoot,
      debugLogPath: debugLogPathFromEnv(),
    },
  }).catch(() => undefined);
  await mkdir(hookRuntimeRoot, { recursive: true });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const workspaceKey = normalizeWorkspaceKey(workspaceFolder);

  const { bridge, token } = createExtensionHookBridge({
    hookRuntimeRoot,
    workspaceRoot: workspaceFolder,
    reviewEngine: options.reviewEngine,
    ui: options.ui,
    isHookReviewEnabled: () => options.getConfigValue('autoMode.enabled') !== false,
  });

  const { port, close } = await listenBridgeHttpServer(bridge);
  const manifestStore = createBridgeManifestStore({ rootDir: hookRuntimeRoot });
  const runtime = await registerBridgeManifest({
    manifestStore,
    manifest: {
      workspaceKey,
      port,
      token,
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: new Date().toISOString(),
    },
    closeServer: close,
  });

  activeBridgeDispose = await replaceBridgeRuntime({
    previousDispose: activeBridgeDispose,
    nextRuntime: runtime,
  });
  await appendDebugLog({
    component: 'extension',
    event: 'hook_bridge_ready',
    details: {
      workspaceKey,
      hookRuntimeRoot,
      port,
    },
  }).catch(() => undefined);
}

/**
 * Minimal composition root for the VS Code / Cursor adapter. Task 15 wires the first
 * real shell path through interception, review, ask handling, and runtime constraints
 * without yet binding to VS Code APIs.
 */
export function createAdapterBundle(config: AdapterBundleConfig) {
  const shellInterceptor = createShellInterceptor({
    source: config.source ?? 'vscode',
  });
  const safeModeController = {
    isInSafeMode: () => false,
  };

  async function handleShellInterception(
    event: ShellInterceptEvent,
    options: HandleShellInterceptionOptions = {},
  ): Promise<ShellExecutionResult> {
    const intercepted = shellInterceptor.intercept(event);
    const command = event.command.join(' ');
    const review = await config.reviewEngine.reviewShellCommand({
      userPrompt: event.intent ?? '',
      command,
      workspaceRoot: event.workspace,
      homeDir: homedir(),
      cwd: event.cwd ?? event.workspace,
    });

    let finalDecision: ReviewDecision;
    let finalDecisionSource: ShellExecutionResult['finalDecisionSource'];

    if (review.finalAction === 'ask') {
      const challenge = buildLocalAskChallenge(intercepted.request.id, review.reason);
      finalDecision = await resolveLocalAskChallenge(challenge, options.promptUser);
      finalDecisionSource = 'local_user_decision';
    } else {
      finalDecision = buildTerminalDecision(intercepted.request.id, review.finalAction, review.reason);
      finalDecisionSource = 'local_model';
    }

    const shouldExecute = finalDecision.decision === 'allow';
    return {
      request: intercepted.request,
      finalDecision,
      finalDecisionSource,
      execution: {
        action: shouldExecute ? 'execute' : 'deny',
        requestId: intercepted.request.id,
        trace: finalDecision.trace,
      },
    };
  }

  return { safeModeController, handleShellInterception };
}

export async function activate(
  context: Pick<ExtensionContext, 'subscriptions'> | { subscriptions: DisposableLike[] },
  deps: Partial<ActivateDependencies> = {},
): Promise<ExtensionRuntime> {
  const resolvedDeps = await resolveActivateDependencies(deps);
  await appendDebugLog({
    component: 'extension',
    event: 'activate_start',
    details: {
      activationEvents: ['onCommand:autoMode.runReviewedShellCommand'],
      debugLogPath: debugLogPathFromEnv(),
    },
  }).catch(() => undefined);
  const ui = resolvedDeps.createUi();
  let reviewEngine: ReturnType<typeof createReviewEngine>;
  let adapterBundle: ReturnType<typeof createAdapterBundle>;
  try {
    const modelConfig = readModelConfig(resolvedDeps.getConfigValue);
    const modelClient = createModelClient(modelConfig);
    reviewEngine = createReviewEngine({ modelClient });
    adapterBundle = createAdapterBundle({
      reviewEngine,
    });
  } catch (error) {
    await appendDebugLog({
      component: 'extension',
      event: 'activation_start_failure',
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
    await ui.showServiceStartFailed(error);
    throw error;
  }

  try {
    await resolvedDeps.startHookBridgeHost({
      getConfigValue: resolvedDeps.getConfigValue,
      ui,
      reviewEngine,
    });
    await ui.setReady(false);
  } catch (error) {
    await appendDebugLog({
      component: 'extension',
      event: 'hook_bridge_start_failure',
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await ui.showServiceStartFailed(new Error(`hook bridge failed to start: ${message}`));
    throw error;
  }
  await appendDebugLog({
    component: 'extension',
    event: 'activate_ready',
    details: {
      command: 'autoMode.runReviewedShellCommand',
    },
  }).catch(() => undefined);

  if (activeBridgeDispose) {
    context.subscriptions.push({
      dispose: () => {
        void disposeActiveBridge();
      },
    });
  }

  const shellEntry = resolvedDeps.createShellEntry({
    adapterBundle,
    ui,
  });

  const commandDisposable = resolvedDeps.registerCommand(
    'autoMode.runReviewedShellCommand',
    async () => shellEntry.run(),
  );
  context.subscriptions.push(commandDisposable);

  const vscodeForToggle = await (resolvedDeps.loadVscodeModule ?? (() => import('vscode')))();
  const toggleDisposable = resolvedDeps.registerCommand('autoMode.toggleHookReview', async () => {
    const config = vscodeForToggle.workspace.getConfiguration('autoMode');
    const cur = config.get<boolean>('enabled', true);
    await config.update('enabled', !cur, vscodeForToggle.ConfigurationTarget.Global);
    await vscodeForToggle.window.showInformationMessage(
      !cur
        ? 'Auto Mode hook review is enabled (PreToolUse / run_in_terminal goes through this extension).'
        : 'Auto Mode hook review is disabled (shell commands are not reviewed by this extension; the host may still enforce its own rules).',
    );
  });
  context.subscriptions.push(toggleDisposable);

  if (ui.refreshReadyAppearance) {
    context.subscriptions.push(
      vscodeForToggle.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('autoMode.enabled')) {
          void ui.refreshReadyAppearance?.();
        }
      }),
    );
  }

  if (ui.dispose) {
    context.subscriptions.push({ dispose: () => ui.dispose?.() });
  }

  return {
    adapterBundle,
  };
}

async function disposeActiveBridge(): Promise<void> {
  if (!activeBridgeDispose) {
    return;
  }
  const close = activeBridgeDispose;
  activeBridgeDispose = undefined;
  await close();
}

export async function deactivate(): Promise<void> {
  await appendDebugLog({
    component: 'extension',
    event: 'deactivate_start',
  }).catch(() => undefined);
  await disposeActiveBridge();
  await appendDebugLog({
    component: 'extension',
    event: 'deactivate_complete',
  }).catch(() => undefined);
}

function buildTerminalDecision(
  requestId: string,
  action: 'allow' | 'deny',
  reason: string,
): ReviewDecision {
  return {
    decision: action,
    reason,
    risk_level: action === 'allow' ? 'low' : 'high',
    trace: { steps: ['local_model_review', action], request_id: requestId },
  };
}

function buildLocalAskChallenge(requestId: string, reason: string): AskChallenge {
  const snapshot: ReviewDecision = {
    decision: 'ask',
    reason,
    risk_level: 'high',
    trace: { steps: ['local_model_review', 'ask'], request_id: requestId },
  };
  return {
    request_id: requestId,
    prompt_text: reason,
    review_snapshot: snapshot,
    decision_context: {
      current_review_snapshot: snapshot,
      matched_risk_labels: [],
      overridable_permissions: ['shell_execute'],
      hard_boundary_summary: 'Local model review requires explicit approval before running this command.',
    },
    allowed_user_actions: ['approve', 'deny', 'cancel'],
    timeout_behavior: 'deny',
  };
}

async function resolveLocalAskChallenge(
  challenge: AskChallenge,
  promptUser: HandleShellInterceptionOptions['promptUser'],
): Promise<ReviewDecision> {
  if (!promptUser) {
    throw new Error('promptUser callback is required for ask responses');
  }
  const action = await promptUser(challenge);
  switch (action) {
    case 'approve':
      return {
        decision: 'allow',
        reason: 'user approved ask challenge',
        risk_level: challenge.review_snapshot.risk_level,
        trace: { steps: ['local_user_decision', 'approve'], request_id: challenge.request_id },
      };
    case 'deny':
      return {
        decision: 'deny',
        reason: 'user denied ask challenge',
        risk_level: challenge.review_snapshot.risk_level,
        trace: { steps: ['local_user_decision', 'deny'], request_id: challenge.request_id },
      };
    case 'cancel':
    default:
      return {
        decision: 'deny',
        reason: 'user cancelled ask challenge',
        risk_level: challenge.review_snapshot.risk_level,
        trace: { steps: ['local_user_decision', 'cancel'], request_id: challenge.request_id },
      };
  }
}

async function resolveActivateDependencies(
  deps: Partial<ActivateDependencies>,
): Promise<ActivateDependencies> {
  if (deps.getConfigValue && deps.createUi && deps.startHookBridgeHost && deps.createShellEntry && deps.registerCommand) {
    return {
      ...deps,
      loadVscodeModule: deps.loadVscodeModule ?? (() => import('vscode')),
    } as ActivateDependencies;
  }

  const vscode = await import('vscode');

  return {
    getConfigValue:
      deps.getConfigValue ??
      ((key) => {
        const [section, setting] = splitConfigKey(key);
        return vscode.workspace.getConfiguration(section).get(setting);
      }),
    createUi:
      deps.createUi ??
      (() => {
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBar.text = 'Auto Mode: Starting';
        statusBar.command = 'autoMode.toggleHookReview';
        statusBar.tooltip = 'Auto Mode: click to toggle auto review (PreToolUse / run_in_terminal), or use settings autoMode.enabled';
        statusBar.show();
        const output = vscode.window.createOutputChannel('Auto Mode');
        return {
          ...createUiController({
            showInformationMessage: async (message) => {
              await vscode.window.showInformationMessage(message);
            },
            showWarningMessage: async (message) => {
              await vscode.window.showWarningMessage(message);
            },
            showErrorMessage: async (message) => {
              await vscode.window.showErrorMessage(message);
            },
            appendLine: (message) => {
              output.appendLine(message);
            },
            setStatus: (text) => {
              statusBar.text = text;
            },
            getHookReviewEnabled: () =>
              vscode.workspace.getConfiguration('autoMode').get<boolean>('enabled', true),
            promptPreToolUseDecision: async ({ title, prompt }) => {
              const picked = await vscode.window.showInformationMessage(
                `${title}\n\n${prompt}`,
                { modal: true },
                'Allow',
                'Deny',
              );
              return picked === 'Allow' ? 'allow' : 'deny';
            },
          }),
          dispose() {
            statusBar.dispose();
            output.dispose();
          },
        };
      }),
    startHookBridgeHost: deps.startHookBridgeHost ?? startHookBridgeHost,
    createShellEntry:
      deps.createShellEntry ??
      ((options) =>
        createShellCommandEntry({
          adapterBundle: options.adapterBundle,
          ui: options.ui,
          promptForCommand: async () =>
            vscode.window.showInputBox({
              prompt: 'Enter the shell command to review and run',
              placeHolder: 'npm test',
            }),
          promptUserAction: async (challenge) => {
            const picked = await vscode.window.showQuickPick(
              challenge.allowed_user_actions.map((action) => ({
                label: action,
                action,
              })),
              {
                title: challenge.prompt_text,
                ignoreFocusOut: true,
              },
            );
            return picked?.action ?? 'cancel';
          },
          executeShell: async (command) => {
            const terminal = vscode.window.createTerminal('Auto Mode Reviewed Shell');
            terminal.show();
            terminal.sendText(command, true);
          },
          showInformationMessage: async (message) => {
            await vscode.window.showInformationMessage(message);
          },
          showWarningMessage: async (message) => {
            await vscode.window.showWarningMessage(message);
          },
          showErrorMessage: async (message) => {
            await vscode.window.showErrorMessage(message);
          },
          getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
          getSessionId: () => 'vscode-extension-session',
          getRequestId: () => randomUUID(),
          now: () => new Date().toISOString(),
        })),
    registerCommand:
      deps.registerCommand ??
      ((command, handler) => vscode.commands.registerCommand(command, handler) as Disposable),
    loadVscodeModule: deps.loadVscodeModule ?? (() => import('vscode')),
  };
}

function splitConfigKey(key: string): [string, string] {
  const dotIndex = key.indexOf('.');
  if (dotIndex < 0) {
    return ['autoMode', key];
  }
  return [key.slice(0, dotIndex), key.slice(dotIndex + 1)];
}
