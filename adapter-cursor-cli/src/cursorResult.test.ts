import { describe, expect, it } from 'vitest';

import {
  buildDryRunCursorPermission,
  preToolUseResultToCursorPermission,
} from './cursorResult.js';

describe('preToolUseResultToCursorPermission', () => {
  it('maps continue true to allow', () => {
    expect(preToolUseResultToCursorPermission({ continue: true })).toEqual({ permission: 'allow' });
  });

  it('maps deny to deny', () => {
    expect(
      preToolUseResultToCursorPermission({
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked',
        },
      }),
    ).toEqual({ permission: 'deny', agentMessage: 'blocked' });
  });

  it('maps ask to deny for headless CLI', () => {
    const out = preToolUseResultToCursorPermission({
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'confirm?',
      },
    });

    expect(out.permission).toBe('deny');
    expect(out.agentMessage).toContain('confirm?');
  });
});

describe('buildDryRunCursorPermission', () => {
  it('renders event, cwd, and command in allow output', () => {
    const out = buildDryRunCursorPermission({
      event: 'beforeShellExecution',
      cwd: '/tmp/proj',
      command: 'pwd',
      decision: 'allow',
    });

    expect(out.permission).toBe('allow');
    expect(out.agentMessage).toContain('beforeShellExecution');
    expect(out.agentMessage).toContain('/tmp/proj');
    expect(out.agentMessage).toContain('pwd');
  });

  it('supports dry-run deny', () => {
    const out = buildDryRunCursorPermission({
      event: 'preToolUse',
      cwd: '/tmp/proj',
      command: 'rm -rf x',
      decision: 'deny',
    });

    expect(out.permission).toBe('deny');
    expect(out.agentMessage).toContain('dry-run');
  });
});
