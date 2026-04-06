import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  activate,
  createExtensionHookBridge,
  deactivate,
  registerBridgeManifest,
  replaceBridgeRuntime,
} from './extension.js';
import { createShellQuarantineStore } from './review/shellQuarantineStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(here, '..');
const packageJSON = JSON.parse(
  readFileSync(path.join(adapterRoot, 'package.json'), 'utf8'),
) as Record<string, unknown>;

/** Avoid `import('vscode')` during vitest `activate()` (Node has no vscode package). */
function loadVscodeModuleStub() {
  return Promise.resolve({
    workspace: {
      getConfiguration: () => ({
        get: (key: string, defaultValue?: unknown) => (key === 'enabled' ? true : defaultValue),
        update: vi.fn().mockResolvedValue(undefined),
      }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    ConfigurationTarget: { Global: 1 },
    window: {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as typeof import('vscode'));
}

describe('adapter extension manifest', () => {
  it('declares the minimum VS Code extension fields', () => {
    expect(packageJSON.engines).toEqual({ vscode: '>=1.105.0' });
    expect(packageJSON.main).toBe('./dist/extension.js');
    expect(packageJSON.activationEvents).toContain('onStartupFinished');
    expect(packageJSON.activationEvents).toContain('onCommand:autoMode.runReviewedShellCommand');
    expect(packageJSON.activationEvents).toContain('onCommand:autoMode.toggleHookReview');
  });

  it('declares install/build/test/package scripts for extension development', () => {
    const scripts = packageJSON.scripts as Record<string, string>;
    expect(scripts.clean).toBe('node ./scripts/clean.js dist');
    expect(scripts['clean:package']).toBe('node ./scripts/clean.js dist vsix');
    expect(scripts.prebuild).toBe('npm run clean');
    expect(scripts['prebuild:hooks']).toBe('npm run clean');
    expect(scripts.prepackage).toBe('npm run clean:package && npm run build');
    expect(scripts.test).toBe('vitest run --exclude src/**/*.live.test.ts');
    expect(scripts['test:live-model']).toBe('vitest run src/review/reviewEngine.live.test.ts');
    expect(scripts.build).toBe('tsc -p .');
    expect(scripts['build:hooks']).toBe('tsc -p .');
    expect(scripts.watch).toBe('tsc -w -p .');
    expect(scripts['devhost:vscode']).toBe('code --extensionDevelopmentPath=.');
    expect(scripts['devhost:cursor']).toBe('cursor --extensionDevelopmentPath=.');
    expect(scripts.package).toBe('vsce package --out ../.artifacts/auto-mode.vsix');
  });

  it('declares the reviewed shell command contribution', () => {
    const contributes = packageJSON.contributes as {
      commands?: Array<{ command: string; title: string }>;
    };
    expect(contributes.commands).toEqual([
      {
        command: 'autoMode.runReviewedShellCommand',
        title: 'Auto Mode: Run Reviewed Shell Command',
      },
      {
        command: 'autoMode.toggleHookReview',
        title: 'Auto Mode: Toggle Hook Review',
      },
    ]);
  });

  it('declares extension settings for local model review only', () => {
    const contributes = packageJSON.contributes as {
      configuration?: {
        properties?: Record<string, { default?: unknown; enum?: string[] }>;
      };
    };
    expect(contributes.configuration?.properties).toMatchObject({
      'autoMode.enabled': { default: true },
      'autoMode.modelProvider': { default: 'anthropic', enum: ['anthropic', 'openai'] },
      'autoMode.modelName': { default: 'claude-3-7-sonnet-latest' },
      'autoMode.apiKey': { default: '' },
      'autoMode.modelTimeoutMs': { default: 120_000 },
    });
    expect(contributes.configuration?.properties).not.toHaveProperty('autoMode.baseUrl');
    expect(contributes.configuration?.properties).not.toHaveProperty('autoMode.sharedSecret');
    expect(contributes.configuration?.properties).not.toHaveProperty('autoMode.autoStartService');
    expect(contributes.configuration?.properties).not.toHaveProperty('autoMode.reviewdCommand');
    expect(contributes.configuration?.properties).toHaveProperty('autoMode.openaiBaseUrl');
  });
});

describe('extension lifecycle', () => {
  it('registerBridgeManifest removes the manifest when the bridge runtime is disposed', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    const closeServer = vi.fn().mockResolvedValue(undefined);

    const runtime = await registerBridgeManifest({
      manifestStore: { put, delete: del },
      manifest: {
        workspaceKey: '/workspace',
        port: 43123,
        token: 'bridge-token',
        adapterIdentity: 'auto-mode-vscode',
        writtenAt: '2026-04-04T10:00:00.000Z',
      },
      closeServer,
    });

    await runtime.dispose();

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: '/workspace', token: 'bridge-token' }),
    );
    expect(closeServer).toHaveBeenCalledWith();
    expect(del).toHaveBeenCalledWith('/workspace');
  });

  it('registerBridgeManifest cleans up manifest state when publishing fails', async () => {
    const closeServer = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);

    await expect(
      registerBridgeManifest({
        manifestStore: {
          put: vi.fn().mockRejectedValue(new Error('manifest write failed')),
          delete: del,
        },
        manifest: {
          workspaceKey: '/workspace',
          port: 43123,
          token: 'bridge-token',
          adapterIdentity: 'auto-mode-vscode',
          writtenAt: '2026-04-04T10:00:00.000Z',
        },
        closeServer,
      }),
    ).rejects.toThrow('manifest write failed');

    expect(del).toHaveBeenCalledWith('/workspace');
    expect(closeServer).toHaveBeenCalledWith();
  });

  it('replaceBridgeRuntime rolls back the newly published runtime when disposing the previous runtime fails', async () => {
    const newCloseServer = vi.fn().mockResolvedValue(undefined);
    const newDelete = vi.fn().mockResolvedValue(undefined);
    const nextRuntime = await registerBridgeManifest({
      manifestStore: {
        put: vi.fn().mockResolvedValue(undefined),
        delete: newDelete,
      },
      manifest: {
        workspaceKey: '/workspace',
        port: 43123,
        token: 'bridge-token',
        adapterIdentity: 'auto-mode-vscode',
        writtenAt: '2026-04-04T10:00:00.000Z',
      },
      closeServer: newCloseServer,
    });

    const previousDispose = vi.fn().mockRejectedValue(new Error('old bridge dispose failed'));

    await expect(
      replaceBridgeRuntime({
        previousDispose,
        nextRuntime,
      }),
    ).rejects.toThrow('old bridge dispose failed');

    expect(previousDispose).toHaveBeenCalledWith();
    expect(newCloseServer).toHaveBeenCalledWith();
    expect(newDelete).toHaveBeenCalledWith('/workspace');
  });

  it('activate reads model config, starts the hook bridge, and registers the reviewed shell command', async () => {
    const registerCommand = vi.fn().mockReturnValue({ dispose: vi.fn() });

    const context = { subscriptions: [] as Array<{ dispose(): void }> };
    const runtime = await activate(context, {
      loadVscodeModule: loadVscodeModuleStub,
      getConfigValue(key) {
        switch (key) {
          case 'autoMode.modelProvider':
            return 'anthropic';
          case 'autoMode.modelName':
            return 'claude-3-7-sonnet-latest';
          case 'autoMode.apiKey':
            return 'sk-test';
          default:
            return undefined;
        }
      },
      createUi() {
        return {
          setReady: vi.fn(),
          refreshReadyAppearance: vi.fn(),
          showServiceStartFailed: vi.fn(),
          showSafeModeState: vi.fn(),
          showAskResolved: vi.fn(),
          showRuntimeConstraintDeny: vi.fn(),
          promptPreToolUseDecision: vi.fn().mockResolvedValue('deny'),
        };
      },
      createShellEntry() {
        return {
          run: vi.fn().mockResolvedValue({ status: 'cancelled' as const }),
        };
      },
      startHookBridgeHost: vi.fn().mockResolvedValue(undefined),
      registerCommand,
    });

    expect(registerCommand).toHaveBeenCalledWith(
      'autoMode.runReviewedShellCommand',
      expect.any(Function),
    );
    expect(registerCommand).toHaveBeenCalledWith('autoMode.toggleHookReview', expect.any(Function));
    expect(context.subscriptions).toHaveLength(3);
    expect(runtime.adapterBundle).toBeTruthy();
  });

  it('registered reviewed shell command runs through the shell entry and host prompts', async () => {
    const registerCommand = vi.fn();
    let handler: (() => Promise<unknown>) | undefined;
    registerCommand.mockImplementation((command, fn) => {
      if (command === 'autoMode.runReviewedShellCommand') {
        handler = fn;
      }
      return { dispose: vi.fn() };
    });

    const promptForCommand = vi.fn().mockResolvedValue('npm test');
    const promptUserAction = vi.fn().mockResolvedValue('approve');
    const executeShell = vi.fn().mockResolvedValue(undefined);
    const showInformationMessage = vi.fn().mockResolvedValue(undefined);

    await activate(
      { subscriptions: [] },
      {
        loadVscodeModule: loadVscodeModuleStub,
        getConfigValue(key) {
          switch (key) {
            case 'autoMode.modelProvider':
              return 'anthropic';
            case 'autoMode.modelName':
              return 'claude-3-7-sonnet-latest';
            case 'autoMode.apiKey':
              return 'sk-test';
            default:
              return undefined;
          }
        },
        createUi() {
          return {
            setReady: vi.fn(),
            refreshReadyAppearance: vi.fn(),
            showServiceStartFailed: vi.fn(),
            showSafeModeState: vi.fn(),
            showAskResolved: vi.fn(),
            showRuntimeConstraintDeny: vi.fn(),
            promptPreToolUseDecision: vi.fn().mockResolvedValue('deny'),
          };
        },
        createShellEntry() {
          return {
            run: vi.fn(async () => {
              const command = await promptForCommand();
              await promptUserAction();
              await executeShell(command);
              await showInformationMessage(`Shell command approved: ${command}`);
              return { status: 'executed' as const };
            }),
          };
        },
        startHookBridgeHost: vi.fn().mockResolvedValue(undefined),
        registerCommand,
      },
    );

    expect(handler).toBeTypeOf('function');
    await handler?.();
    expect(promptForCommand).toHaveBeenCalledWith();
    expect(promptUserAction).toHaveBeenCalledWith();
    expect(executeShell).toHaveBeenCalledWith('npm test');
    expect(showInformationMessage).toHaveBeenCalledWith('Shell command approved: npm test');
  });

  it('shows a visible error before activate fails when required model config is missing', async () => {
    const showServiceStartFailed = vi.fn().mockResolvedValue(undefined);

    await expect(
      activate(
        { subscriptions: [] },
        {
          getConfigValue() {
            return undefined;
          },
          createUi() {
            return {
              setReady: vi.fn(),
              refreshReadyAppearance: vi.fn(),
              showServiceStartFailed,
              showSafeModeState: vi.fn(),
              showAskResolved: vi.fn(),
              showRuntimeConstraintDeny: vi.fn(),
              promptPreToolUseDecision: vi.fn().mockResolvedValue('deny'),
            };
          },
          createShellEntry() {
            return {
              run: vi.fn().mockResolvedValue({ status: 'cancelled' as const }),
            };
          },
          startHookBridgeHost: vi.fn().mockResolvedValue(undefined),
          registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        },
      ),
    ).rejects.toThrow();

    expect(showServiceStartFailed).toHaveBeenCalledWith(expect.any(Error));
  });

  it('fails explicitly when the extension-host bridge cannot start', async () => {
    const showServiceStartFailed = vi.fn().mockResolvedValue(undefined);

    await expect(
      activate(
        { subscriptions: [] },
        {
          loadVscodeModule: loadVscodeModuleStub,
          getConfigValue(key) {
            switch (key) {
              case 'autoMode.modelProvider':
                return 'anthropic';
              case 'autoMode.modelName':
                return 'claude-3-7-sonnet-latest';
              case 'autoMode.apiKey':
                return 'sk-test';
              default:
                return undefined;
            }
          },
          createUi() {
            return {
              setReady: vi.fn(),
              refreshReadyAppearance: vi.fn(),
              showServiceStartFailed,
              showSafeModeState: vi.fn(),
              showAskResolved: vi.fn(),
              showRuntimeConstraintDeny: vi.fn(),
              promptPreToolUseDecision: vi.fn().mockResolvedValue('deny'),
            };
          },
          startHookBridgeHost: vi.fn().mockRejectedValue(new Error('bridge publish failed')),
          createShellEntry() {
            return {
              run: vi.fn().mockResolvedValue({ status: 'cancelled' as const }),
            };
          },
          registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        },
      ),
    ).rejects.toThrow('bridge publish failed');

    expect(showServiceStartFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('hook bridge failed to start: bridge publish failed'),
      }),
    );
  });

  it('deactivate works after activation without a service manager', async () => {
    await activate(
      { subscriptions: [] },
      {
        loadVscodeModule: loadVscodeModuleStub,
        getConfigValue(key) {
          switch (key) {
            case 'autoMode.modelProvider':
              return 'anthropic';
            case 'autoMode.modelName':
              return 'claude-3-7-sonnet-latest';
            case 'autoMode.apiKey':
              return 'sk-test';
            default:
              return undefined;
          }
        },
        createUi() {
          return {
            setReady: vi.fn(),
            refreshReadyAppearance: vi.fn(),
            showServiceStartFailed: vi.fn(),
            showSafeModeState: vi.fn(),
            showAskResolved: vi.fn(),
            showRuntimeConstraintDeny: vi.fn(),
            promptPreToolUseDecision: vi.fn().mockResolvedValue('deny'),
          };
        },
        createShellEntry() {
          return {
            run: vi.fn().mockResolvedValue({ status: 'cancelled' as const }),
          };
        },
        startHookBridgeHost: vi.fn().mockResolvedValue(undefined),
        registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
    );

    await deactivate();
  });
});

describe('shellQuarantineStore', () => {
  const key = { sessionId: 's1', workspaceRoot: '/ws' };

  it('quarantines after 2 symlink_risk denies', () => {
    let t = 1_000_000;
    const store = createShellQuarantineStore({ now: () => t++ });
    expect(store.isQuarantined(key)).toBe(false);
    store.recordDeny(key, 'symlink_risk');
    expect(store.isQuarantined(key)).toBe(false);
    store.recordDeny(key, 'symlink_risk');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('quarantines after 3 consecutive denies', () => {
    const store = createShellQuarantineStore();
    store.recordDeny(key, 'phase1');
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(false);
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('clearDenyStreak resets consecutive deny counting after allows', () => {
    const store = createShellQuarantineStore();
    store.recordDeny(key, 'phase1');
    store.recordDeny(key, 'phase1');
    store.clearDenyStreak(key);
    store.recordDeny(key, 'phase1');
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(false);
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('clearDenyStreak resets only consecutive denies and preserves recent and symlink-risk history', () => {
    let t = 1_000_000;
    const store = createShellQuarantineStore({
      now: () => t,
      maxConsecutiveDenies: 99,
      maxSymlinkRiskDenies: 2,
      maxRecentDeniesInWindow: 99,
    });

    store.recordDeny(key, 'phase2');
    store.clearDenyStreak(key);

    t += 1_000;
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(false);

    t += 1_000;
    store.recordDeny(key, 'phase2');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('quarantines after reaching the recent-window deny threshold', () => {
    let t = 1_000_000;
    const store = createShellQuarantineStore({
      now: () => t,
      maxRecentDeniesInWindow: 5,
      maxConsecutiveDenies: 99,
      maxSymlinkRiskDenies: 99,
    });

    for (let i = 0; i < 4; i += 1) {
      store.recordDeny(key, 'phase1');
      expect(store.isQuarantined(key)).toBe(false);
      t += 1_000;
    }

    store.recordDeny(key, 'resolve');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('drops denies outside the recent window before counting toward quarantine', () => {
    let t = 1_000_000;
    const store = createShellQuarantineStore({
      now: () => t,
      recentWindowMs: 10_000,
      maxRecentDeniesInWindow: 3,
      maxConsecutiveDenies: 99,
      maxSymlinkRiskDenies: 99,
    });

    store.recordDeny(key, 'phase1');
    t += 5_000;
    store.recordDeny(key, 'resolve');
    expect(store.isQuarantined(key)).toBe(false);

    t += 10_001;
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(false);

    t += 1_000;
    store.recordDeny(key, 'resolve');
    expect(store.isQuarantined(key)).toBe(false);

    t += 1_000;
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(true);
  });

  it('keeps recent-window deny accumulation across allows while timestamps stay in window', () => {
    let t = 1_000_000;
    const store = createShellQuarantineStore({
      now: () => t,
      recentWindowMs: 10_000,
      maxRecentDeniesInWindow: 3,
      maxConsecutiveDenies: 99,
      maxSymlinkRiskDenies: 99,
    });

    store.recordDeny(key, 'phase1');
    t += 1_000;
    store.recordDeny(key, 'resolve');
    store.clearDenyStreak(key);
    expect(store.isQuarantined(key)).toBe(false);

    t += 1_000;
    store.recordDeny(key, 'phase1');
    expect(store.isQuarantined(key)).toBe(true);
  });
});

describe('createExtensionHookBridge two-phase PreToolUse', () => {
  function fakeUi() {
    return {
      promptPreToolUseDecision: vi.fn().mockResolvedValue('deny' as const),
      showAskResolved: vi.fn(),
    };
  }

  function makePreToolUsePayload(command: string, toolName = 'run_in_terminal') {
    return {
      session_id: 'sess-1',
      tool_name: toolName,
      tool_use_id: 'tool-use-1',
      cwd: '/workspace',
      timestamp: '2026-04-06T10:00:00.000Z',
      tool_input: { command },
    };
  }

  it('denies when phase 1 extraction is incomplete', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
        allow: false,
        reason: 'cannot determine paths',
        complete: false,
        accesses: [],
      }),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > x'),
    })) as {
      continue?: boolean;
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('cannot determine paths');
    expect(reviewEngine.reviewPhase2ResolvedAccesses).not.toHaveBeenCalled();
  });

  it('allows when resolver does not require phase 2', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
        allow: true,
        reason: 'ok',
        complete: true,
        accesses: [{ kind: 'r' as const, path: 'src/main.ts', glob: false }],
      }),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: true,
      needsPhase2: false,
      accesses: [
        {
          kind: 'r' as const,
          path: 'src/main.ts',
          expanded: '/workspace/src/main.ts',
          real: '/workspace/src/main.ts',
          symlink: 'n' as const,
          real_from: 'target' as const,
        },
      ],
    });

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('cat src/main.ts'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('ok');
    expect(reviewEngine.reviewPhase2ResolvedAccesses).not.toHaveBeenCalled();
  });

  it('denies when resolver needs phase 2 and phase 2 denies', async () => {
    const reviewPhase2ResolvedAccesses = vi.fn().mockResolvedValue({
      allow: false,
      reason: 'realpath escapes workspace',
    });

    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
        allow: true,
        reason: 'ok',
        complete: true,
        accesses: [{ kind: 'w' as const, path: 'safe-link/new.txt', glob: false }],
      }),
      reviewPhase2ResolvedAccesses,
      reviewShellCommand: vi.fn(),
    };

    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: true,
      needsPhase2: true,
      accesses: [
        {
          kind: 'w' as const,
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/etc/new.txt',
          symlink: 'y' as const,
          real_from: 'parent' as const,
        },
      ],
    });

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(reviewPhase2ResolvedAccesses).toHaveBeenCalled();
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('workspace');
  });

  it('allows when resolver needs phase 2 and phase 2 allows', async () => {
    const reviewPhase2ResolvedAccesses = vi.fn().mockResolvedValue({
      allow: true,
      reason: 'resolved realpaths stay within the workspace',
    });

    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
        allow: true,
        reason: 'phase 1 provisional allow',
        complete: true,
        accesses: [{ kind: 'w' as const, path: 'safe-link/new.txt', glob: false }],
      }),
      reviewPhase2ResolvedAccesses,
      reviewShellCommand: vi.fn(),
    };

    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: true,
      needsPhase2: true,
      accesses: [
        {
          kind: 'w' as const,
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/workspace/actual/new.txt',
          symlink: 'y' as const,
          real_from: 'parent' as const,
        },
      ],
    });

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(reviewPhase2ResolvedAccesses).toHaveBeenCalled();
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBe(
      'resolved realpaths stay within the workspace',
    );
  });

  it('denies when local path resolution fails', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
        allow: true,
        reason: 'ok',
        complete: true,
        accesses: [{ kind: 'r' as const, path: '*.missing', glob: true }],
      }),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: false,
      needsPhase2: false,
      accesses: [],
      reason: 'glob matched nothing',
    });

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('cat *.missing'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('glob matched nothing');
    expect(reviewEngine.reviewPhase2ResolvedAccesses).not.toHaveBeenCalled();
  });

  it('passes through non-run_in_terminal tools without two-phase review', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn(),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('', 'read_file'),
    })) as { continue?: boolean };

    expect(result).toEqual({ continue: true });
    expect(reviewEngine.reviewPhase1ShellCommand).not.toHaveBeenCalled();
  });

  it('allows run_in_terminal without review when hook review is disabled in settings', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn(),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      isHookReviewEnabled: () => false,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo hi'),
    })) as {
      continue?: boolean;
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('disabled');
    expect(reviewEngine.reviewPhase1ShellCommand).not.toHaveBeenCalled();
    expect(reviewEngine.reviewPhase2ResolvedAccesses).not.toHaveBeenCalled();
  });

  it('denies immediately when quarantined without calling the review engine', async () => {
    const reviewEngine = {
      reviewPhase1ShellCommand: vi.fn(),
      reviewPhase2ResolvedAccesses: vi.fn(),
      reviewShellCommand: vi.fn(),
    };

    const shellQuarantine = createShellQuarantineStore();
    const qKey = { sessionId: 'sess-1', workspaceRoot: '/workspace' };
    shellQuarantine.recordDeny(qKey, 'phase1');
    shellQuarantine.recordDeny(qKey, 'phase1');
    shellQuarantine.recordDeny(qKey, 'phase1');

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: reviewEngine as Parameters<typeof createExtensionHookBridge>[0]['reviewEngine'],
      ui: fakeUi(),
      token: 'test-token',
      shellQuarantine,
    });

    const result = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo hi'),
    })) as {
      continue?: boolean;
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(result.continue).toBe(false);
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toMatch(/locked/i);
    expect(reviewEngine.reviewPhase1ShellCommand).not.toHaveBeenCalled();
    expect(reviewEngine.reviewPhase2ResolvedAccesses).not.toHaveBeenCalled();
  });

  it('treats repeated phase2 denies as symlink-risk denials that lead to quarantine', async () => {
    const reviewPhase2ResolvedAccesses = vi.fn().mockResolvedValue({
      allow: false,
      reason: 'realpath escapes workspace',
    });
    const reviewPhase1ShellCommand = vi.fn().mockResolvedValue({
      allow: true,
      reason: 'phase 1 provisional allow',
      complete: true,
      accesses: [{ kind: 'w' as const, path: 'safe-link/new.txt', glob: false }],
    });
    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: true,
      needsPhase2: true,
      accesses: [
        {
          kind: 'w' as const,
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/etc/new.txt',
          symlink: 'y' as const,
          real_from: 'parent' as const,
        },
      ],
    });
    const shellQuarantine = createShellQuarantineStore();

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewPhase1ShellCommand,
        reviewPhase2ResolvedAccesses,
        reviewShellCommand: vi.fn(),
      },
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
      shellQuarantine,
    });

    const first = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(first.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(shellQuarantine.isQuarantined({ sessionId: 'sess-1', workspaceRoot: '/workspace' })).toBe(false);

    const second = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(second.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(shellQuarantine.isQuarantined({ sessionId: 'sess-1', workspaceRoot: '/workspace' })).toBe(true);

    await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    });

    expect(reviewPhase1ShellCommand).toHaveBeenCalledTimes(2);
    expect(reviewPhase2ResolvedAccesses).toHaveBeenCalledTimes(2);
  });

  it('preserves symlink-risk accumulation across an allowed phase2 review', async () => {
    const reviewPhase2ResolvedAccesses = vi
      .fn()
      .mockResolvedValueOnce({
        allow: false,
        reason: 'realpath escapes workspace',
      })
      .mockResolvedValueOnce({
        allow: true,
        reason: 'resolved realpaths stay within the workspace',
      })
      .mockResolvedValueOnce({
        allow: false,
        reason: 'realpath escapes workspace again',
      });
    const reviewPhase1ShellCommand = vi.fn().mockResolvedValue({
      allow: true,
      reason: 'phase 1 provisional allow',
      complete: true,
      accesses: [{ kind: 'w' as const, path: 'safe-link/new.txt', glob: false }],
    });
    const resolvePhase1Accesses = vi.fn().mockResolvedValue({
      ok: true,
      needsPhase2: true,
      accesses: [
        {
          kind: 'w' as const,
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/etc/new.txt',
          symlink: 'y' as const,
          real_from: 'parent' as const,
        },
      ],
    });
    const shellQuarantine = createShellQuarantineStore();

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: '/tmp/auto-mode-hook-runtime',
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewPhase1ShellCommand,
        reviewPhase2ResolvedAccesses,
        reviewShellCommand: vi.fn(),
      },
      ui: fakeUi(),
      token: 'test-token',
      resolvePhase1Accesses,
      shellQuarantine,
    });

    const first = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(first.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(shellQuarantine.isQuarantined({ sessionId: 'sess-1', workspaceRoot: '/workspace' })).toBe(false);

    const second = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(second.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(shellQuarantine.isQuarantined({ sessionId: 'sess-1', workspaceRoot: '/workspace' })).toBe(false);

    const third = (await bridge.handle('PreToolUse', {
      token,
      ...makePreToolUsePayload('echo test > safe-link/new.txt'),
    })) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(third.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(shellQuarantine.isQuarantined({ sessionId: 'sess-1', workspaceRoot: '/workspace' })).toBe(true);
  });
});
