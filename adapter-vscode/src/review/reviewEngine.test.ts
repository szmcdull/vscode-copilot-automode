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
});
