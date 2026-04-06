import { describe, expect, it, vi } from 'vitest';
import { createReviewEngine } from './reviewEngine.js';

describe('review engine', () => {
  it('contracts model output into a final allow/deny/ask result', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({ decision: 'ask', reason: 'Deletes files outside the workspace.' }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });
    const result = await engine.reviewShellCommand({
      userPrompt: '清理构建产物',
      command: 'rm -rf ../build',
      workspaceRoot: '/workspace',
      homeDir: '/home/mugi',
      cwd: '/workspace',
    });

    expect(result).toEqual(
      expect.objectContaining({
        finalAction: 'ask',
        reason: expect.stringContaining('Deletes files'),
      }),
    );
  });

  it('never returns allow_with_constraints to the host layer', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({ decision: 'allow_with_constraints', reason: 'only in workspace' }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });
    const result = await engine.reviewShellCommand({
      userPrompt: '整理代码',
      command: 'python scripts/rewrite.py',
      workspaceRoot: '/workspace',
      homeDir: '/home/mugi',
      cwd: '/workspace',
    });

    expect(result.finalAction).toBe('ask');
    expect(result.rawModelDecision).toBe('allow_with_constraints');
    expect(result.degradedFromConstraints).toBe(true);
    expect(result.reason).toContain('host');
    expect(result.reason).toContain('constraints');
  });

  it('serializes shell review context as a JSON block in the prompt', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({ decision: 'allow', reason: 'Safe in current workspace.' }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });
    await engine.reviewShellCommand({
      userPrompt: '整理代码',
      command: 'python scripts/rewrite.py',
      workspaceRoot: '/workspace',
      homeDir: '/home/mugi',
      cwd: '/workspace/subdir',
    });

    expect(model.complete).toHaveBeenCalledWith(
      expect.stringContaining(
        [
          '```json',
          '{',
          '  "userPrompt": "整理代码",',
          '  "command": "python scripts/rewrite.py",',
          '  "workspaceRoot": "/workspace",',
          '  "homeDir": "/home/mugi",',
          '  "cwd": "/workspace/subdir"',
          '}',
          '```',
        ].join('\n'),
      ),
    );
    expect(model.complete).not.toHaveBeenCalledWith(expect.stringContaining('- command:'));
  });

  it('fails fast on malformed JSON', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue('{'),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewShellCommand({
        userPrompt: '清理构建产物',
        command: 'rm -rf ../build',
        workspaceRoot: '/workspace',
        homeDir: '/home/mugi',
        cwd: '/workspace',
      }),
    ).rejects.toThrow('Review model output is not valid JSON');
  });

  it('fails fast on invalid decisions', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({ decision: 'maybe', reason: 'Unsure.' }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewShellCommand({
        userPrompt: '清理构建产物',
        command: 'rm -rf ../build',
        workspaceRoot: '/workspace',
        homeDir: '/home/mugi',
        cwd: '/workspace',
      }),
    ).rejects.toThrow('Invalid review decision: maybe');
  });

  it('fails fast on blank reasons', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ decision: 'deny', reason: '   ' })),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewShellCommand({
        userPrompt: '清理构建产物',
        command: 'rm -rf ../build',
        workspaceRoot: '/workspace',
        homeDir: '/home/mugi',
        cwd: '/workspace',
      }),
    ).rejects.toThrow('Review model JSON must include a non-empty string "reason"');
  });

  it('accepts complete fenced JSON output', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        ['```json', '{"decision":"deny","reason":"Dangerous command."}', '```'].join('\n'),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });
    const result = await engine.reviewShellCommand({
      userPrompt: '清理构建产物',
      command: 'rm -rf ../build',
      workspaceRoot: '/workspace',
      homeDir: '/home/mugi',
      cwd: '/workspace',
    });

    expect(result.finalAction).toBe('deny');
  });

  it('rejects incomplete fenced JSON output', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        ['```json', '{"decision":"deny","reason":"Dangerous command."}'].join('\n'),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewShellCommand({
        userPrompt: '清理构建产物',
        command: 'rm -rf ../build',
        workspaceRoot: '/workspace',
        homeDir: '/home/mugi',
        cwd: '/workspace',
      }),
    ).rejects.toThrow('Review model output fence is not closed');
  });

  it('builds a phase-1 prompt that requires allow/complete/accesses JSON', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          allow: 'y',
          reason: 'workspace-only access',
          complete: 'y',
          accesses: [{ kind: 'r', path: 'src/**/*.ts', glob: 'y' }],
        }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    const result = await engine.reviewPhase1ShellCommand({
      userPrompt: 'read source files',
      command: 'sed -n "1,10p" src/**/*.ts',
      workspaceRoot: '/workspace',
      homeDir: '/home/test',
      cwd: '/workspace',
    });

    expect(result.allow).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.accesses).toEqual([{ kind: 'r', path: 'src/**/*.ts', glob: true }]);
    expect(model.complete).toHaveBeenCalledWith(expect.stringContaining('"allow":"y|n"'));
  });

  it('parses a phase-2 allow or deny result', async () => {
    const model = {
      complete: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({
            allow: 'y',
            reason: 'workspace-only access',
            complete: 'y',
            accesses: [],
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ allow: 'n', reason: 'realpath escapes workspace' })),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await engine.reviewPhase1ShellCommand({
      userPrompt: '',
      command: 'pwd',
      workspaceRoot: '/workspace',
      homeDir: '/home/test',
      cwd: '/workspace',
    });

    const result = await engine.reviewPhase2ResolvedAccesses({
      cmd: 'echo x > safe-link/new.txt',
      cwd: '/workspace',
      complete: 'y',
      accesses: [
        {
          kind: 'w',
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/etc/new.txt',
          symlink: 'y',
          real_from: 'parent',
        },
      ],
    });

    expect(result.allow).toBe(false);
    expect(result.reason).toContain('workspace');
  });

  it('fails closed on phase-2 incomplete input without calling the model', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ allow: 'y', reason: 'safe' })),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    const result = await engine.reviewPhase2ResolvedAccesses({
      cmd: 'echo x > safe-link/new.txt',
      cwd: '/workspace',
      complete: 'n',
      accesses: [
        {
          kind: 'w',
          path: 'safe-link/new.txt',
          expanded: '/workspace/safe-link/new.txt',
          real: '/etc/new.txt',
          symlink: 'y',
          real_from: 'parent',
        },
      ],
    });

    expect(result).toEqual({
      allow: false,
      reason: expect.stringContaining('incomplete'),
    });
    expect(model.complete).not.toHaveBeenCalled();
  });

  it('fails fast on invalid phase-2 model output', async () => {
    const invalidJsonModel = {
      complete: vi.fn().mockResolvedValue('{'),
    };
    const invalidAllowModel = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ allow: 'maybe', reason: 'unsafe' })),
    };
    const blankReasonModel = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ allow: 'n', reason: '   ' })),
    };

    const invalidJsonEngine = createReviewEngine({ modelClient: invalidJsonModel as any });
    const invalidAllowEngine = createReviewEngine({ modelClient: invalidAllowModel as any });
    const blankReasonEngine = createReviewEngine({ modelClient: blankReasonModel as any });

    const input = {
      cmd: 'echo x > safe-link/new.txt',
      cwd: '/workspace',
      complete: 'y' as const,
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
    };

    await expect(invalidJsonEngine.reviewPhase2ResolvedAccesses(input)).rejects.toThrow(
      'Phase 2 review model output is not valid JSON',
    );
    await expect(invalidAllowEngine.reviewPhase2ResolvedAccesses(input)).rejects.toThrow(
      'Phase 2 review model JSON must include "allow" as "y" or "n"',
    );
    await expect(blankReasonEngine.reviewPhase2ResolvedAccesses(input)).rejects.toThrow(
      'Phase 2 review model JSON must include a non-empty string "reason"',
    );
  });

  it('rejects contradictory phase-1 allow and complete values', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          allow: 'y',
          reason: 'workspace-only access',
          complete: 'n',
          accesses: [],
        }),
      ),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewPhase1ShellCommand({
        userPrompt: 'read source files',
        command: 'sed -n "1,10p" src/**/*.ts',
        workspaceRoot: '/workspace',
        homeDir: '/home/test',
        cwd: '/workspace',
      }),
    ).rejects.toThrow('Phase 1 review model JSON must not return allow:"y" with complete:"n"');
  });

  it('rejects invalid phase-2 input enums before building the prompt', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ allow: 'y', reason: 'safe' })),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'maybe' as any,
        accesses: [
          {
            kind: 'w',
            path: 'safe-link/new.txt',
            expanded: '/workspace/safe-link/new.txt',
            real: '/etc/new.txt',
            symlink: 'y',
            real_from: 'parent',
          },
        ],
      }),
    ).rejects.toThrow('Phase 2 review input must include "complete" as "y" or "n"');

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'y',
        accesses: [
          {
            kind: 'maybe' as any,
            path: 'safe-link/new.txt',
            expanded: '/workspace/safe-link/new.txt',
            real: '/etc/new.txt',
            symlink: 'y',
            real_from: 'parent',
          },
        ],
      }),
    ).rejects.toThrow('Phase 2 review input access must include "kind" as "r", "w", or "del"');

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'y',
        accesses: [
          {
            kind: 'w',
            path: 'safe-link/new.txt',
            expanded: '/workspace/safe-link/new.txt',
            real: '/etc/new.txt',
            symlink: 'maybe' as any,
            real_from: 'parent',
          },
        ],
      }),
    ).rejects.toThrow('Phase 2 review input access must include "symlink" as "y" or "n"');

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'y',
        accesses: [
          {
            kind: 'w',
            path: 'safe-link/new.txt',
            expanded: '/workspace/safe-link/new.txt',
            real: '/etc/new.txt',
            symlink: 'y',
            real_from: 'elsewhere' as any,
          },
        ],
      }),
    ).rejects.toThrow('Phase 2 review input access must include "real_from" as "target" or "parent"');

    expect(model.complete).not.toHaveBeenCalled();
  });

  it('rejects missing fields and empty strings in phase-2 input before building the prompt', async () => {
    const model = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({ allow: 'y', reason: 'safe' })),
    };

    const engine = createReviewEngine({ modelClient: model as any });

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: '   ' as any,
        cwd: '/workspace',
        complete: 'y',
        accesses: [],
      }),
    ).rejects.toThrow('Phase 2 review input must include non-empty string "cmd"');

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'y',
        accesses: [
          {
            kind: 'w',
            path: '   ',
            expanded: '/workspace/safe-link/new.txt',
            real: '/etc/new.txt',
            symlink: 'y',
            real_from: 'parent',
          },
        ],
      }),
    ).rejects.toThrow('Phase 2 review input access must include non-empty string "path"');

    await expect(
      engine.reviewPhase2ResolvedAccesses({
        cmd: 'echo x > safe-link/new.txt',
        cwd: '/workspace',
        complete: 'y',
        accesses: [
          {
            kind: 'w',
            path: 'safe-link/new.txt',
            expanded: '/workspace/safe-link/new.txt',
            symlink: 'y',
            real_from: 'parent',
          } as any,
        ],
      }),
    ).rejects.toThrow('Phase 2 review input access must include non-empty string "real"');

    expect(model.complete).not.toHaveBeenCalled();
  });
});
