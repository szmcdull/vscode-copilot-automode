import { describe, expect, it, vi } from 'vitest';
import { createPostToolUseHandler } from './postToolUse.js';

describe('PostToolUse handler', () => {
  it('returns continue true for non run_in_terminal without touching local link state', async () => {
    const consumeRequestId = vi.fn();
    const handler = createPostToolUseHandler({
      linkStore: { getLink: vi.fn(), consumeRequestId, markUserDecisionSubmitted: vi.fn() },
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'read_file',
      tool_use_id: 'tool-1',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
    });

    expect(result).toEqual({ continue: true });
    expect(consumeRequestId).not.toHaveBeenCalled();
  });

  it('returns continue true when link store has no request id', async () => {
    const getLink = vi.fn().mockResolvedValue(null);
    const consumeRequestId = vi.fn();
    const handler = createPostToolUseHandler({
      linkStore: { getLink, consumeRequestId, markUserDecisionSubmitted: vi.fn() },
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-orphan',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
    });

    expect(result).toEqual({ continue: true });
    expect(getLink).toHaveBeenCalledWith('tool-orphan', 'sess-1');
    expect(consumeRequestId).not.toHaveBeenCalled();
  });

  it('consumes local link state after a completed terminal command', async () => {
    const getLink = vi.fn().mockResolvedValue({
      requestId: 'req-ask',
      needsUserDecisionApprove: true,
      reviewResultKind: 'local_review',
    });
    const consumeRequestId = vi.fn().mockResolvedValue('req-ask');
    const handler = createPostToolUseHandler({
      linkStore: {
        getLink,
        consumeRequestId,
        markUserDecisionSubmitted: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-ask',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
      tool_response: { stdout: 'ok' },
    });

    expect(result).toEqual({ continue: true });
    expect(consumeRequestId).toHaveBeenCalledWith('tool-ask', 'sess-1');
  });

  it('consumes local link state even when the command did not require a user decision', async () => {
    const getLink = vi.fn().mockResolvedValue({
      requestId: 'req-99',
      needsUserDecisionApprove: false,
      reviewResultKind: 'local_review',
    });
    const consumeRequestId = vi.fn().mockResolvedValue('req-99');
    const handler = createPostToolUseHandler({
      linkStore: { getLink, consumeRequestId, markUserDecisionSubmitted: vi.fn() },
    });

    await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-99',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
      tool_response: { stdout: 'ok', exit_code: 0 },
    });

    expect(getLink).toHaveBeenCalledWith('tool-99', 'sess-1');
    expect(consumeRequestId).toHaveBeenCalledWith('tool-99', 'sess-1');
  });

  it('consumes local ask fallback links without special remote handling', async () => {
    const getLink = vi.fn().mockResolvedValue({
      requestId: 'req-local-only',
      needsUserDecisionApprove: false,
      reviewResultKind: 'local_review',
    });
    const consumeRequestId = vi.fn().mockResolvedValue('req-local-only');
    const handler = createPostToolUseHandler({
      linkStore: { getLink, consumeRequestId, markUserDecisionSubmitted: vi.fn() },
    });

    const result = await handler({
      session_id: 'sess-1',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-fallback',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
      tool_response: { stdout: 'ok' },
    });

    expect(result).toEqual({ continue: true });
    expect(consumeRequestId).toHaveBeenCalledWith('tool-fallback', 'sess-1');
  });

  it('does not report execution when stored session does not match', async () => {
    const getLink = vi.fn().mockResolvedValue(null);
    const consumeRequestId = vi.fn();
    const handler = createPostToolUseHandler({
      linkStore: { getLink, consumeRequestId, markUserDecisionSubmitted: vi.fn() },
    });

    const result = await handler({
      session_id: 'sess-new',
      tool_name: 'run_in_terminal',
      tool_use_id: 'tool-reused',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:10.000Z',
      tool_response: { stdout: 'should-not-report' },
    });

    expect(result).toEqual({ continue: true });
    expect(getLink).toHaveBeenCalledWith('tool-reused', 'sess-new');
    expect(consumeRequestId).not.toHaveBeenCalled();
  });
});
