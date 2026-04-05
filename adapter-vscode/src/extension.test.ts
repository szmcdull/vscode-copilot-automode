import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { activate, deactivate, registerBridgeManifest, replaceBridgeRuntime } from './extension.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(here, '..');
const packageJSON = JSON.parse(
  readFileSync(path.join(adapterRoot, 'package.json'), 'utf8'),
) as Record<string, unknown>;

describe('adapter extension manifest', () => {
  it('declares the minimum VS Code extension fields', () => {
    expect(packageJSON.engines).toEqual({ vscode: '>=1.105.0' });
    expect(packageJSON.main).toBe('./dist/extension.js');
    expect(packageJSON.activationEvents).toContain('onStartupFinished');
    expect(packageJSON.activationEvents).toContain('onCommand:autoMode.runReviewedShellCommand');
  });

  it('declares install/build/test/package scripts for extension development', () => {
    const scripts = packageJSON.scripts as Record<string, string>;
    expect(scripts.clean).toBe('node ./scripts/clean.js dist');
    expect(scripts['clean:package']).toBe('node ./scripts/clean.js dist vsix');
    expect(scripts.prebuild).toBe('npm run clean');
    expect(scripts['prebuild:hooks']).toBe('npm run clean');
    expect(scripts.prepackage).toBe('npm run clean:package && npm run build');
    expect(scripts.test).toBe('vitest run');
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
    ]);
  });

  it('declares extension settings for local model review only', () => {
    const contributes = packageJSON.contributes as {
      configuration?: {
        properties?: Record<string, { default?: unknown; enum?: string[] }>;
      };
    };
    expect(contributes.configuration?.properties).toMatchObject({
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
    expect(context.subscriptions).toHaveLength(1);
    expect(runtime.adapterBundle).toBeTruthy();
  });

  it('registered reviewed shell command runs through the shell entry and host prompts', async () => {
    const registerCommand = vi.fn();
    let handler: (() => Promise<unknown>) | undefined;
    registerCommand.mockImplementation((_command, fn) => {
      handler = fn;
      return { dispose: vi.fn() };
    });

    const promptForCommand = vi.fn().mockResolvedValue('npm test');
    const promptUserAction = vi.fn().mockResolvedValue('approve');
    const executeShell = vi.fn().mockResolvedValue(undefined);
    const showInformationMessage = vi.fn().mockResolvedValue(undefined);

    await activate(
      { subscriptions: [] },
      {
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
