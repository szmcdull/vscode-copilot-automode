import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHookCli,
  createHookCliDepsFromBridge,
  resolveHookCliDepsFromPayload,
  runHookCliOnce,
} from './cli.js';
import { sessionContextFilePath } from './runtimePaths.js';

describe('hook cli', () => {
  it('dispatches UserPromptSubmit to the matching handler', async () => {
    const userPromptSubmit = vi.fn().mockResolvedValue({ continue: true });
    const cli = createHookCli({
      userPromptSubmit,
      preToolUse: vi.fn(),
      postToolUse: vi.fn(),
    });

    const result = await cli.run('UserPromptSubmit', {
      session_id: 'sess-1',
      prompt: 'run pwd',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:02.337Z',
    });

    expect(userPromptSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'sess-1',
        prompt: 'run pwd',
        cwd: '/workspace',
        timestamp: '2026-04-04T07:42:02.337Z',
      }),
    );
    expect(result).toEqual({ continue: true });
  });

  it('fails unknown hook names clearly', async () => {
    const cli = createHookCli({
      userPromptSubmit: vi.fn(),
      preToolUse: vi.fn(),
      postToolUse: vi.fn(),
    });

    await expect(cli.run('BadHook', {})).rejects.toThrow('unsupported hook event: BadHook');
  });

  it('fails when argv[2] hook event name is missing', async () => {
    const write = vi.fn();

    await expect(
      runHookCliOnce({
        argv: ['node', 'dist/hooks/cli.js'],
        rawPayload:
          '{"session_id":"sess-1","prompt":"run pwd","cwd":"/workspace","timestamp":"2026-04-04T07:42:02.337Z"}',
        write,
      }),
    ).rejects.toThrow('missing hook event name (argv[2])');

    expect(write).not.toHaveBeenCalled();
  });

  it('fails when stdin is not valid JSON', async () => {
    const write = vi.fn();

    await expect(
      runHookCliOnce({
        argv: ['node', 'dist/hooks/cli.js', 'UserPromptSubmit'],
        rawPayload: '{not-json',
        write,
      }),
    ).rejects.toThrow();

    expect(write).not.toHaveBeenCalled();
  });
});

describe('hook cli bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AUTO_MODE_HOOK_RUNTIME_ROOT;
  });

  it('createHookCliDepsFromBridge forwards PreToolUse through the bridge client', async () => {
    const client = {
      invoke: vi.fn().mockResolvedValue({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'approved by extension UI',
        },
      }),
    };

    const deps = createHookCliDepsFromBridge({
      bridgeClient: client as any,
      workspaceKey: '/workspace',
    });

    const result = await deps.preToolUse({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T10:00:00.000Z',
      tool_input: { command: 'npm test' },
    });

    expect(client.invoke).toHaveBeenCalledWith(
      'PreToolUse',
      expect.objectContaining({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        cwd: '/workspace',
        tool_input: { command: 'npm test' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: 'allow',
        }),
      }),
    );
  });

  it('returns final host allow after extension-owned approval (bridge response)', async () => {
    const client = {
      invoke: vi.fn().mockResolvedValue({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'approved by extension UI',
        },
      }),
    };

    const deps = createHookCliDepsFromBridge({
      bridgeClient: client as any,
      workspaceKey: '/workspace',
    });

    const result = (await deps.preToolUse({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T10:00:00.000Z',
      tool_input: { command: 'npm test' },
    })) as { hookSpecificOutput?: { permissionDecision?: string } };

    expect(client.invoke).toHaveBeenCalled();
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('uses the closest parent workspace manifest for a subdirectory cwd', async () => {
    const testRoot = path.join('/tmp', `auto-mode-hook-cli-bridge-${process.pid}`);
    await mkdir(testRoot, { recursive: true });
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = testRoot;

    const { createBridgeManifestStore } = await import('../bridge/manifest.js');
    await createBridgeManifestStore({ rootDir: testRoot }).put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ continue: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const deps = await resolveHookCliDepsFromPayload(
      'PreToolUse',
      {
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace/packages/app',
        timestamp: '2026-04-04T10:00:00.000Z',
        tool_input: { command: 'npm test' },
      },
      process.env,
    );

    await expect(
      deps.preToolUse({
        session_id: 'sess-1',
        tool_name: 'run_in_terminal',
        tool_use_id: 'tool-1',
        cwd: '/workspace/packages/app',
        timestamp: '2026-04-04T10:00:00.000Z',
        tool_input: { command: 'npm test' },
      }),
    ).resolves.toEqual({ continue: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:43123/bridge',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails clearly when no bridge manifest is available', async () => {
    const testRoot = path.join('/tmp', `auto-mode-hook-cli-no-bridge-${process.pid}`);
    await mkdir(testRoot, { recursive: true });
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = testRoot;

    await expect(
      resolveHookCliDepsFromPayload(
        'PreToolUse',
        {
          session_id: 'sess-1',
          tool_name: 'run_in_terminal',
          tool_use_id: 'tool-1',
          cwd: '/workspace/subdir',
          timestamp: '2026-04-04T10:00:00.000Z',
          tool_input: { command: 'pwd' },
        },
        process.env,
      ),
    ).rejects.toThrow('bridge manifest');
  });

  it('deletes a stale manifest and surfaces bridge unavailability without legacy env fallback', async () => {
    const testRoot = path.join('/tmp', `auto-mode-hook-cli-bridge-fallback-${process.pid}`);
    await mkdir(testRoot, { recursive: true });
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = testRoot;

    const { createBridgeManifestStore } = await import('../bridge/manifest.js');
    const store = createBridgeManifestStore({ rootDir: testRoot });
    await store.put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://127.0.0.1:43123/bridge') {
        throw new Error('connect ECONNREFUSED');
      }

      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(
      runHookCliOnce({
        argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
        rawPayload: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'run_in_terminal',
          tool_use_id: 'tool-1',
          cwd: '/workspace/subdir',
          timestamp: '2026-04-04T10:00:00.000Z',
          tool_input: { command: 'pwd' },
        }),
      }),
    ).rejects.toThrow('bridge request failed before receiving a response');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(store.get('/workspace')).resolves.toBeNull();
  });

  it('preserves the manifest and surfaces bridge handler errors without falling back to env', async () => {
    const testRoot = path.join('/tmp', `auto-mode-hook-cli-bridge-handler-error-${process.pid}`);
    await mkdir(testRoot, { recursive: true });
    process.env.AUTO_MODE_HOOK_RUNTIME_ROOT = testRoot;

    const { createBridgeManifestStore } = await import('../bridge/manifest.js');
    const store = createBridgeManifestStore({ rootDir: testRoot });
    await store.put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model 404' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    await expect(
      runHookCliOnce({
        argv: ['node', 'dist/hooks/cli.js', 'PreToolUse'],
        rawPayload: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'run_in_terminal',
          tool_use_id: 'tool-1',
          cwd: '/workspace/subdir',
          timestamp: '2026-04-04T10:00:00.000Z',
          tool_input: { command: 'pwd' },
        }),
      }),
    ).rejects.toThrow('bridge request failed (500): {"error":"model 404"}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(store.get('/workspace')).resolves.toEqual(
      expect.objectContaining({
        workspaceKey: '/workspace',
        port: 43123,
      }),
    );
  });
});
