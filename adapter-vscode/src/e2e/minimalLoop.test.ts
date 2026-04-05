import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridgeManifestStore } from '../bridge/manifest.js';
import { createExtensionHookBridge } from '../extension.js';
import { runHookCliOnce } from '../hooks/cli.js';

describe('adapter minimal closed loop', () => {
  const runtimeRoot = path.join(tmpdir(), `auto-mode-minimal-loop-${process.pid}`);
  const envKeys = ['AUTO_MODE_HOOK_RUNTIME_ROOT'] as const;

  afterEach(async () => {
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  it('follows hook CLI -> bridge manifest -> extension bridge -> self-ask -> final host allow', async () => {
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = runtimeRoot;

    const reviewShellCommand = vi.fn().mockResolvedValue({
      finalAction: 'ask',
      reason: 'Needs local approval before running npm test.',
      rawModelDecision: 'ask',
      degradedFromConstraints: false,
    });
    const promptPreToolUseDecision = vi.fn().mockResolvedValue('allow');
    const showAskResolved = vi.fn().mockResolvedValue(undefined);
    const submitUserDecision = vi.fn();

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: runtimeRoot,
      workspaceRoot: '/workspace',
      reviewEngine: { reviewShellCommand } as any,
      reviewClient: {
        observeExecution: vi.fn(),
        submitUserDecision,
      } as any,
      ui: {
        promptPreToolUseDecision,
        showAskResolved,
      } as any,
    });

    await createBridgeManifestStore({ rootDir: runtimeRoot }).put({
      workspaceKey: '/workspace',
      port: 43123,
      token,
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:43123/bridge');
      const body = JSON.parse(String(init?.body)) as { hookEventName: string; payload: unknown };
      const result = await bridge.handle(body.hookEventName, body.payload);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const writes: string[] = [];
    await runHookCliOnce({
      argv: ['node', 'dist/hooks/cli.js', 'UserPromptSubmit'],
      rawPayload: JSON.stringify({
        session_id: 'sess-1',
        prompt: 'run npm test',
        cwd: '/workspace',
        timestamp: '2026-04-04T10:00:00.000Z',
      }),
      write: (output) => {
        writes.push(output);
      },
    });
    await runHookCliOnce({
      argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
      rawPayload: JSON.stringify({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace',
        timestamp: '2026-04-04T10:00:01.000Z',
        tool_input: { command: 'npm test' },
      }),
      write: (output) => {
        writes.push(output);
      },
    });

    const finalResult = JSON.parse(writes.at(-1) ?? 'null') as {
      continue: boolean;
      hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reviewShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: 'run npm test',
        command: 'npm test',
        workspaceRoot: '/workspace',
        cwd: '/workspace',
      }),
    );
    expect(promptPreToolUseDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Confirm terminal command',
      }),
    );
    expect(showAskResolved).toHaveBeenCalledWith('approve');
    expect(submitUserDecision).not.toHaveBeenCalled();
    expect(finalResult).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Needs local approval before running npm test.',
      },
    });
  });

  it('does not block the hook response on the ask-resolved notification after local approval', async () => {
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = runtimeRoot;

    const reviewShellCommand = vi.fn().mockResolvedValue({
      finalAction: 'ask',
      reason: 'Recursive deletion requires explicit local approval.',
      rawModelDecision: 'ask',
      degradedFromConstraints: false,
    });
    const promptPreToolUseDecision = vi.fn().mockResolvedValue('allow');
    const showAskResolved = vi.fn(
      () =>
        new Promise<void>(() => {
          // Simulate a notification promise that never settles before the hook timeout window.
        }),
    );

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: runtimeRoot,
      workspaceRoot: '/workspace',
      reviewEngine: { reviewShellCommand } as any,
      reviewClient: {
        observeExecution: vi.fn(),
        submitUserDecision: vi.fn(),
      } as any,
      ui: {
        promptPreToolUseDecision,
        showAskResolved,
      } as any,
    });

    await createBridgeManifestStore({ rootDir: runtimeRoot }).put({
      workspaceKey: '/workspace',
      port: 43123,
      token,
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    vi.stubGlobal(
      'fetch',
      (async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://127.0.0.1:43123/bridge');
        const body = JSON.parse(String(init?.body)) as { hookEventName: string; payload: unknown };
        const result = await bridge.handle(body.hookEventName, body.payload);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    );

    const writes: string[] = [];
    await runHookCliOnce({
      argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
      rawPayload: JSON.stringify({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace',
        timestamp: '2026-04-04T10:00:01.000Z',
        tool_input: { command: 'rm -rf ~/Downloads/free-code-main' },
      }),
      write: (output) => {
        writes.push(output);
      },
    });

    const finalResult = JSON.parse(writes.at(-1) ?? 'null') as {
      continue: boolean;
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(promptPreToolUseDecision).toHaveBeenCalled();
    expect(showAskResolved).toHaveBeenCalledWith('approve');
    expect(finalResult).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Recursive deletion requires explicit local approval.',
      },
    });
  });

  it('returns explicit host allow without prompting when the review engine allows directly', async () => {
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = runtimeRoot;

    const reviewShellCommand = vi.fn().mockResolvedValue({
      finalAction: 'allow',
      reason: 'The command only prints a string and does not modify the workspace.',
      rawModelDecision: 'allow',
      degradedFromConstraints: false,
    });
    const promptPreToolUseDecision = vi.fn();
    const showAskResolved = vi.fn();

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: runtimeRoot,
      workspaceRoot: '/workspace',
      reviewEngine: { reviewShellCommand } as any,
      reviewClient: {
        observeExecution: vi.fn(),
        submitUserDecision: vi.fn(),
      } as any,
      ui: {
        promptPreToolUseDecision,
        showAskResolved,
      } as any,
    });

    await createBridgeManifestStore({ rootDir: runtimeRoot }).put({
      workspaceKey: '/workspace',
      port: 43123,
      token,
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    vi.stubGlobal(
      'fetch',
      (async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://127.0.0.1:43123/bridge');
        const body = JSON.parse(String(init?.body)) as { hookEventName: string; payload: unknown };
        const result = await bridge.handle(body.hookEventName, body.payload);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    );

    const writes: string[] = [];
    await runHookCliOnce({
      argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
      rawPayload: JSON.stringify({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace',
        timestamp: '2026-04-04T10:00:01.000Z',
        tool_input: { command: 'printf "user test"' },
      }),
      write: (output) => {
        writes.push(output);
      },
    });

    const finalResult = JSON.parse(writes.at(-1) ?? 'null') as {
      continue: boolean;
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };

    expect(reviewShellCommand).toHaveBeenCalled();
    expect(promptPreToolUseDecision).not.toHaveBeenCalled();
    expect(showAskResolved).not.toHaveBeenCalled();
    expect(finalResult).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          'The command only prints a string and does not modify the workspace.',
      },
    });
  });

  it('follows the same bridge/self-ask path and returns final host deny', async () => {
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = runtimeRoot;

    const promptPreToolUseDecision = vi.fn().mockResolvedValue('deny');
    const showAskResolved = vi.fn().mockResolvedValue(undefined);

    const { bridge, token } = createExtensionHookBridge({
      hookRuntimeRoot: runtimeRoot,
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewShellCommand: vi.fn().mockResolvedValue({
          finalAction: 'ask',
          reason: 'Deletes files outside the workspace.',
          rawModelDecision: 'ask',
          degradedFromConstraints: false,
        }),
      } as any,
      reviewClient: {
        observeExecution: vi.fn(),
        submitUserDecision: vi.fn(),
      } as any,
      ui: {
        promptPreToolUseDecision,
        showAskResolved,
      } as any,
    });

    await createBridgeManifestStore({ rootDir: runtimeRoot }).put({
      workspaceKey: '/workspace',
      port: 43123,
      token,
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    vi.stubGlobal(
      'fetch',
      (async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://127.0.0.1:43123/bridge');
        const body = JSON.parse(String(init?.body)) as { hookEventName: string; payload: unknown };
        const result = await bridge.handle(body.hookEventName, body.payload);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    );

    const writes: string[] = [];
    await runHookCliOnce({
      argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
      rawPayload: JSON.stringify({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace',
        timestamp: '2026-04-04T10:00:01.000Z',
        tool_input: { command: 'rm -rf ../build' },
      }),
      write: (output) => {
        writes.push(output);
      },
    });

    const finalResult = JSON.parse(writes.at(-1) ?? 'null') as {
      continue: boolean;
      hookSpecificOutput?: { permissionDecision?: string };
    };
    expect(promptPreToolUseDecision).toHaveBeenCalled();
    expect(showAskResolved).toHaveBeenCalledWith('deny');
    expect(finalResult).toEqual({
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Deletes files outside the workspace.',
      },
    });
  });
});
