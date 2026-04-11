import { describe, expect, it } from 'vitest';

import { RUN_IN_TERMINAL_TOOL_NAME } from '../../shared/src/toolNames.js';
import {
  cursorPayloadToPreToolUse,
  extractShellCommandFromCursorPayload,
} from './cursorPayload.js';

describe('extractShellCommandFromCursorPayload', () => {
  it('reads top-level command', () => {
    expect(extractShellCommandFromCursorPayload({ command: 'npm test' })).toBe('npm test');
  });

  it('reads nested tool_input.command', () => {
    expect(
      extractShellCommandFromCursorPayload({
        tool_input: { command: 'ls -la' },
      }),
    ).toBe('ls -la');
  });
});

describe('cursorPayloadToPreToolUse', () => {
  it('maps beforeShellExecution to run_in_terminal payload', () => {
    const payload = cursorPayloadToPreToolUse(
      'beforeShellExecution',
      {
        cwd: '/tmp/proj',
        session_id: 'sess-1',
        tool_use_id: 'tool-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        command: 'pwd',
      },
      () => '2026-01-01T00:00:00.000Z',
    );

    expect(payload.tool_name).toBe(RUN_IN_TERMINAL_TOOL_NAME);
    expect(payload.tool_input.command).toBe('pwd');
    expect(payload.cwd).toBe('/tmp/proj');
  });

  it('normalizes Shell preToolUse to run_in_terminal', () => {
    const payload = cursorPayloadToPreToolUse(
      'preToolUse',
      {
        cwd: '/workspace',
        session_id: 'sess-1',
        tool_use_id: 'tool-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        tool_name: 'Shell',
        tool_input: { command: 'echo hi' },
      },
      () => '2026-01-01T00:00:00.000Z',
    );

    expect(payload.tool_name).toBe(RUN_IN_TERMINAL_TOOL_NAME);
    expect(payload.tool_input.command).toBe('echo hi');
  });
});
