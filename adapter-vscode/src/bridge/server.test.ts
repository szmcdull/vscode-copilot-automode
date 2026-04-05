import { describe, expect, it, vi } from 'vitest';
import { createBridgeServer } from './server.js';

describe('bridge server', () => {
  it('forwards PreToolUse payloads to the configured handler and returns JSON', async () => {
    const preToolUse = vi.fn().mockResolvedValue({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked by review',
      },
    });

    const server = createBridgeServer({
      token: 'bridge-token',
      handlers: {
        userPromptSubmit: vi.fn(),
        preToolUse,
        postToolUse: vi.fn(),
      },
    });

    const res = await server.handle('PreToolUse', {
      token: 'bridge-token',
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T10:00:00.000Z',
      tool_input: { command: 'rm -rf .' },
    });

    expect(preToolUse).toHaveBeenCalled();
    expect(res.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('rejects requests with an invalid token', async () => {
    const preToolUse = vi.fn();
    const server = createBridgeServer({
      token: 'bridge-token',
      handlers: {
        userPromptSubmit: vi.fn(),
        preToolUse,
        postToolUse: vi.fn(),
      },
    });

    await expect(
      server.handle('PreToolUse', {
        token: 'wrong-token',
        session_id: 'sess-1',
      }),
    ).rejects.toThrow('invalid bridge token for event PreToolUse');

    expect(preToolUse).not.toHaveBeenCalled();
  });

  it('rejects unknown events with event context', async () => {
    const server = createBridgeServer({
      token: 'bridge-token',
      handlers: {
        userPromptSubmit: vi.fn(),
        preToolUse: vi.fn(),
        postToolUse: vi.fn(),
      },
    });

    await expect(
      server.handle('UnknownEvent', {
        token: 'bridge-token',
      }),
    ).rejects.toThrow('unsupported hook event: UnknownEvent');
  });
});
