import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskChallenge } from '../protocol/types.js';
import { createAskSessionManager } from './askSession.js';

function makeChallenge(
  overrides: Partial<AskChallenge> = {},
  snapshotOverrides: Partial<AskChallenge['review_snapshot']> = {},
): AskChallenge {
  const snapshot = {
    decision: 'ask' as const,
    reason: 'needs user confirmation',
    risk_level: 'high' as const,
    trace: { origin: 'test' },
    ...snapshotOverrides,
  };

  return {
    request_id: 'req-ask-1',
    prompt_text: 'Proceed?',
    review_snapshot: snapshot,
    decision_context: {
      current_review_snapshot: snapshot,
      matched_risk_labels: ['workspace_escape'],
      overridable_permissions: ['workspace_escape'],
      hard_boundary_summary: 'Needs explicit user confirmation.',
    },
    allowed_user_actions: ['approve', 'deny', 'cancel'],
    timeout_behavior: 'deny',
    ...overrides,
  };
}

describe('AskSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks until the user provides a decision, then preserves request_id in override trace', async () => {
    const manager = createAskSessionManager({ timeoutMs: 1000 });
    const challenge = makeChallenge();

    let settled = false;
    const pending = manager.startAsk(challenge).then((decision) => {
      settled = true;
      return decision;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const accepted = manager.resolveUserDecision(challenge.request_id, 'approve');
    expect(accepted).toBe(true);

    const decision = await pending;
    expect(decision).toEqual({
      decision: 'allow',
      reason: 'user approved ask challenge',
      risk_level: 'high',
      trace: {
        steps: ['user_override', 'approve'],
        request_id: challenge.request_id,
      },
    });
  });

  it('on timeout, defaults to deny or cancel behavior and returns final deny', async () => {
    const denyManager = createAskSessionManager({ timeoutMs: 1000 });
    const cancelManager = createAskSessionManager({ timeoutMs: 1000 });

    const denyPromise = denyManager.startAsk(makeChallenge({ request_id: 'req-timeout-deny' }));
    const cancelPromise = cancelManager.startAsk(
      makeChallenge({ request_id: 'req-timeout-cancel', timeout_behavior: 'cancel' }),
    );

    await vi.advanceTimersByTimeAsync(1000);

    await expect(denyPromise).resolves.toEqual({
      decision: 'deny',
      reason: 'ask challenge timed out with deny',
      risk_level: 'high',
      trace: {
        steps: ['ask_timeout', 'deny'],
        request_id: 'req-timeout-deny',
      },
    });
    await expect(cancelPromise).resolves.toEqual({
      decision: 'deny',
      reason: 'ask challenge timed out with cancel',
      risk_level: 'high',
      trace: {
        steps: ['ask_timeout', 'cancel'],
        request_id: 'req-timeout-cancel',
      },
    });
  });

  it('returns the same decision for repeated calls with the same request_id', async () => {
    const manager = createAskSessionManager({ timeoutMs: 1000 });
    const challenge = makeChallenge({ request_id: 'req-repeat-1' });

    const first = manager.startAsk(challenge);
    const second = manager.startAsk({ ...challenge });
    expect(first).toBe(second);

    manager.resolveUserDecision(challenge.request_id, 'deny');

    await expect(first).resolves.toEqual({
      decision: 'deny',
      reason: 'user denied ask challenge',
      risk_level: 'high',
      trace: {
        steps: ['user_override', 'deny'],
        request_id: challenge.request_id,
      },
    });
    await expect(manager.startAsk(challenge)).resolves.toEqual({
      decision: 'deny',
      reason: 'user denied ask challenge',
      risk_level: 'high',
      trace: {
        steps: ['user_override', 'deny'],
        request_id: challenge.request_id,
      },
    });
  });
});
