import { describe, expect, it, vi } from 'vitest';
import { assertPreToolUsePayload } from './types.js';
import { createPreToolUseHandler } from './preToolUse.js';

describe('PreToolUse handler', () => {
  it('builds a shell review request from run_in_terminal plus stored prompt context', async () => {
    const review = vi.fn().mockResolvedValue({
      kind: 'service',
      response: {
        request_id: 'req-1',
        status: 'final',
        review_decision: {
          decision: 'allow',
          reason: 'safe',
          risk_level: 'low',
          trace: {},
        },
        adapter_identity: 'auto-mode-hooks',
      },
    });

    const handler = createPreToolUseHandler({
      reviewClient: { review } as any,
      sessionStore: {
        get: vi.fn().mockResolvedValue({
          sessionId: 'sess-1',
          prompt: '执行外部命令pwd并打印结果',
          cwd: '/workspace',
          transcriptPath: '/tmp/transcript.jsonl',
          storedAt: '2026-04-04T07:42:02.337Z',
        }),
      } as any,
      now: () => '2026-04-04T07:42:08.335Z',
      requestId: () => 'req-1',
    });

    await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:08.335Z',
      tool_input: {
        command: 'pwd',
        explanation: 'Run pwd',
        goal: 'Show current directory',
        isBackground: false,
        timeout: 10000,
      },
    });

    const request = review.mock.calls[0]?.[0];
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'req-1',
        session: 'sess-1',
        tool: 'run_terminal_cmd',
        category: 'shell',
        intent: '执行外部命令pwd并打印结果',
        arguments: expect.objectContaining({
          command: 'pwd',
          goal: 'Show current directory',
          explanation: 'Run pwd',
        }),
        model_context: expect.objectContaining({
          user_prompt: '执行外部命令pwd并打印结果',
          transcript_path: '/tmp/transcript.jsonl',
          hook_tool_use_id: 'tool-1',
          host_tool_name: 'run_in_terminal',
          host_tool_goal: 'Show current directory',
          host_tool_explanation: 'Run pwd',
        }),
      }),
      expect.anything(),
    );
    expect(request.tool).not.toBe('run_in_terminal');
    expect(request.requested_permissions).toEqual(['shell_execute']);
    expect(request.normalized_effects).toEqual({
      may_spawn_process: true,
      escapes_workspace: false,
    });
  });

  it('maps ask_pending to host ask and stores a local review link', async () => {
    const linkPut = vi.fn().mockResolvedValue(undefined);
    const handler = createPreToolUseHandler({
      reviewClient: {
        review: vi.fn().mockResolvedValue({
          kind: 'service',
          response: {
            request_id: 'req-ask-1',
            status: 'ask_pending',
            ask_challenge: {
              request_id: 'req-ask-1',
              prompt_text: 'Need confirmation before running pwd',
              review_snapshot: {
                decision: 'ask',
                reason: 'Needs confirmation',
                risk_level: 'medium',
                trace: {},
              },
              decision_context: {
                current_review_snapshot: {
                  decision: 'ask',
                  reason: 'Needs confirmation',
                  risk_level: 'medium',
                  trace: {},
                },
                matched_risk_labels: [],
                overridable_permissions: ['shell_execute'],
                hard_boundary_summary: 'No hard deny matched',
              },
              allowed_user_actions: ['approve', 'deny', 'cancel'],
              timeout_behavior: 'deny',
            },
            adapter_identity: 'auto-mode-hooks',
          },
        }),
      } as any,
      sessionStore: {
        get: vi.fn().mockResolvedValue({
          sessionId: 'sess-1',
          prompt: '执行外部命令pwd并打印结果',
          cwd: '/workspace',
          transcriptPath: '/tmp/transcript.jsonl',
          storedAt: '2026-04-04T07:42:02.337Z',
        }),
      } as any,
      now: () => '2026-04-04T07:42:08.335Z',
      requestId: () => 'req-ask-1',
      linkStore: {
        put: linkPut,
        consumeRequestId: vi.fn().mockResolvedValue(null),
      } as any,
    });
    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-ask-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:08.335Z',
      tool_input: {
        command: 'pwd',
        explanation: 'Run pwd',
        goal: 'Show current directory',
        isBackground: false,
        timeout: 10000,
      },
    });
    expect(linkPut).toHaveBeenCalledWith('tool-ask-1', 'req-ask-1', 'sess-1', {
      needsUserDecisionApprove: true,
      reviewResultKind: 'local_review',
    });
    expect(result.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('stores ask_pending links as local reviews for host-side follow-up', async () => {
    const linkPut = vi.fn().mockResolvedValue(undefined);
    const handler = createPreToolUseHandler({
      reviewClient: {
        review: vi.fn().mockResolvedValue({
          kind: 'safe_mode_fallback',
          fallbackReason: 'safe_mode_degraded_high_trust_paths_to_ask',
          response: {
            request_id: 'req-fallback-1',
            status: 'ask_pending',
            ask_challenge: {
              request_id: 'req-fallback-1',
              prompt_text: 'Safe mode',
              review_snapshot: {
                decision: 'ask',
                reason: 'safe',
                risk_level: 'high',
                trace: {},
              },
              decision_context: {
                current_review_snapshot: {
                  decision: 'ask',
                  reason: 'safe',
                  risk_level: 'high',
                  trace: {},
                },
                matched_risk_labels: [],
                overridable_permissions: [],
                hard_boundary_summary: 'x',
              },
              allowed_user_actions: ['approve', 'deny', 'cancel'],
              timeout_behavior: 'deny',
            },
            adapter_identity: 'auto-mode-hooks',
          },
        }),
      } as any,
      sessionStore: {
        get: vi.fn().mockResolvedValue({
          sessionId: 'sess-1',
          prompt: 'x',
          cwd: '/workspace',
          transcriptPath: null,
          storedAt: '2026-04-04T07:42:02.337Z',
        }),
      } as any,
      now: () => '2026-04-04T07:42:08.335Z',
      requestId: () => 'req-fallback-1',
      linkStore: {
        put: linkPut,
        consumeRequestId: vi.fn().mockResolvedValue(null),
      } as any,
    });

    await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-fallback-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:08.335Z',
      tool_input: {
        command: 'pwd',
        explanation: 'Run pwd',
        goal: 'Show current directory',
        isBackground: false,
        timeout: 10000,
      },
    });

    expect(linkPut).toHaveBeenCalledWith('tool-fallback-1', 'req-fallback-1', 'sess-1', {
      needsUserDecisionApprove: true,
      reviewResultKind: 'local_review',
    });
  });

  it('maps allow_with_constraints to host deny (hooks cannot enforce runtime constraints)', async () => {
    const handler = createPreToolUseHandler({
      reviewClient: {
        review: vi.fn().mockResolvedValue({
          kind: 'service',
          response: {
            request_id: 'req-constraints-1',
            status: 'final',
            review_decision: {
              decision: 'allow_with_constraints',
              reason: 'allowed only with command allowlist',
              risk_level: 'medium',
              constraints: {
                command_template_allowlist: ['pwd'],
              },
              trace: {},
            },
            adapter_identity: 'auto-mode-hooks',
          },
        }),
      } as any,
      sessionStore: {
        get: vi.fn().mockResolvedValue({
          sessionId: 'sess-1',
          prompt: '执行外部命令pwd并打印结果',
          cwd: '/workspace',
          transcriptPath: '/tmp/transcript.jsonl',
          storedAt: '2026-04-04T07:42:02.337Z',
        }),
      } as any,
      now: () => '2026-04-04T07:42:08.335Z',
      requestId: () => 'req-constraints-1',
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-constraints-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:08.335Z',
      tool_input: {
        command: 'pwd',
        explanation: 'Run pwd',
        goal: 'Show current directory',
      },
    });

    expect(result).toEqual({
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'allowed only with command allowlist',
      },
    });
  });

  it('returns continue true for non-shell tools without calling review', async () => {
    const review = vi.fn();
    const handler = createPreToolUseHandler({
      reviewClient: { review } as any,
      sessionStore: { get: vi.fn() } as any,
      now: () => '2026-04-04T07:42:08.335Z',
      requestId: () => 'req-1',
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'read_file',
      tool_use_id: 'tool-2',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:08.335Z',
      tool_input: { path: '/tmp/x' },
    });

    expect(review).not.toHaveBeenCalled();
    expect(result).toEqual({ continue: true });
  });

  it('rejects tool_input when it is an array (not a record)', () => {
    expect(() =>
      assertPreToolUsePayload({
        session_id: 's',
        tool_name: 'run_in_terminal',
        tool_use_id: 't',
        cwd: '/w',
        timestamp: '2026-04-04T00:00:00.000Z',
        tool_input: ['not', 'a', 'record'],
      }),
    ).toThrow('invalid PreToolUse payload');
  });
});
