import type { AskChallenge, ReviewDecision, UserAction } from '../protocol/types.js';

export interface AskSessionManagerOptions {
  timeoutMs: number;
}

interface PendingSession {
  challenge: AskChallenge;
  promise: Promise<ReviewDecision>;
  resolve: (decision: ReviewDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AskSessionManager {
  startAsk(challenge: AskChallenge): Promise<ReviewDecision>;
  resolveUserDecision(requestId: string, action: UserAction): boolean;
  resolveFinalDecision(requestId: string, decision: ReviewDecision): boolean;
}

export function createAskSessionManager(options: AskSessionManagerOptions): AskSessionManager {
  const pending = new Map<string, PendingSession>();
  const completed = new Map<string, ReviewDecision>();

  function settle(requestId: string, decision: ReviewDecision): void {
    const session = pending.get(requestId);
    if (!session) {
      completed.set(requestId, decision);
      return;
    }
    clearTimeout(session.timer);
    pending.delete(requestId);
    completed.set(requestId, decision);
    session.resolve(decision);
  }

  return {
    startAsk(challenge) {
      const cached = completed.get(challenge.request_id);
      if (cached) {
        return Promise.resolve(cached);
      }

      const existing = pending.get(challenge.request_id);
      if (existing) {
        return existing.promise;
      }

      let resolveDecision!: (decision: ReviewDecision) => void;
      const promise = new Promise<ReviewDecision>((resolve) => {
        resolveDecision = resolve;
      });
      const timer = setTimeout(() => {
        settle(challenge.request_id, timeoutDecision(challenge));
      }, Math.max(1, options.timeoutMs));

      pending.set(challenge.request_id, {
        challenge,
        promise,
        resolve: resolveDecision,
        timer,
      });

      return promise;
    },

    resolveUserDecision(requestId, action) {
      const session = pending.get(requestId);
      if (!session) {
        return completed.has(requestId);
      }
      if (!session.challenge.allowed_user_actions.includes(action)) {
        return false;
      }
      settle(requestId, userDecision(session.challenge, action));
      return true;
    },
    resolveFinalDecision(requestId, decision) {
      if (!pending.has(requestId)) {
        return completed.has(requestId);
      }
      settle(requestId, decision);
      return true;
    },
  };
}

function userDecision(challenge: AskChallenge, action: UserAction): ReviewDecision {
  const risk = challenge.review_snapshot.risk_level;
  switch (action) {
    case 'approve':
      return {
        decision: 'allow',
        reason: 'user approved ask challenge',
        risk_level: risk,
        trace: { steps: ['user_override', 'approve'], request_id: challenge.request_id },
      };
    case 'deny':
      return {
        decision: 'deny',
        reason: 'user denied ask challenge',
        risk_level: risk,
        trace: { steps: ['user_override', 'deny'], request_id: challenge.request_id },
      };
    case 'cancel':
      return {
        decision: 'deny',
        reason: 'user cancelled ask challenge',
        risk_level: risk,
        trace: { steps: ['user_override', 'cancel'], request_id: challenge.request_id },
      };
    default:
      return {
        decision: 'deny',
        reason: 'user denied ask challenge',
        risk_level: risk,
        trace: { steps: ['user_override', 'deny'], request_id: challenge.request_id },
      };
  }
}

function timeoutDecision(challenge: AskChallenge): ReviewDecision {
  return {
    decision: 'deny',
    reason: `ask challenge timed out with ${challenge.timeout_behavior}`,
    risk_level: challenge.review_snapshot.risk_level,
    trace: { steps: ['ask_timeout', challenge.timeout_behavior], request_id: challenge.request_id },
  };
}
