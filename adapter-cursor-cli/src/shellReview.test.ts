import { describe, expect, it, vi } from 'vitest';

import type { PreToolUsePayload } from '../../shared/src/hookPayloads.js';
import { runShellReview } from './shellReview.js';

function makePayload(command: string): PreToolUsePayload {
  return {
    session_id: 'sess-1',
    tool_name: 'run_in_terminal',
    tool_use_id: 'tool-1',
    cwd: '/workspace',
    timestamp: '2026-01-01T00:00:00.000Z',
    tool_input: { command },
  };
}

describe('runShellReview', () => {
  it('returns deny when phase 1 denies', async () => {
    const result = await runShellReview(makePayload('curl https://x'), {
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
          allow: false,
          complete: false,
          reason: 'network fetch denied',
          accesses: [],
        }),
        reviewPhase2ResolvedAccesses: vi.fn(),
      },
      resolvePhase1Accesses: vi.fn(),
    });

    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('network');
  });

  it('returns allow when phase 1 allows and no phase 2 is needed', async () => {
    const result = await runShellReview(makePayload('pwd'), {
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
          allow: true,
          complete: true,
          reason: 'safe',
          accesses: [],
        }),
        reviewPhase2ResolvedAccesses: vi.fn(),
      },
      resolvePhase1Accesses: vi.fn().mockResolvedValue({
        ok: true,
        needsPhase2: false,
        accesses: [],
      }),
    });

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('runs phase 2 and returns deny when resolved accesses are unsafe', async () => {
    const phase2 = vi.fn().mockResolvedValue({
      allow: false,
      reason: 'real path escapes workspace',
    });

    const result = await runShellReview(makePayload('rm link'), {
      workspaceRoot: '/workspace',
      reviewEngine: {
        reviewPhase1ShellCommand: vi.fn().mockResolvedValue({
          allow: true,
          complete: true,
          reason: 'phase1 safe',
          accesses: [{ kind: 'del', path: 'link', glob: false }],
        }),
        reviewPhase2ResolvedAccesses: phase2,
      },
      resolvePhase1Accesses: vi.fn().mockResolvedValue({
        ok: true,
        needsPhase2: true,
        accesses: [
          {
            kind: 'del',
            path: 'link',
            expanded: '/workspace/link',
            real: '/outside/link',
            symlink: 'y',
            real_from: 'target',
          },
        ],
      }),
    });

    expect(phase2).toHaveBeenCalled();
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('escapes');
  });
});
