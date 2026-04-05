import type { PreToolUseHookResult } from '../protocol/types.js';
import type { ReviewHTTPResponse } from '../protocol/types.js';

export function mapReviewHttpResponseToPreToolUseHook(response: ReviewHTTPResponse): PreToolUseHookResult {
  if (response.status === 'ask_pending') {
    return {
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
          permissionDecisionReason: response.ask_challenge?.prompt_text ?? 'local review requested confirmation',
      },
    };
  }

  const decision = response.review_decision?.decision;
  if (decision === 'allow') {
    return { continue: true };
  }

  if (decision === 'allow_with_constraints') {
    // Hook runtime does not enforce compiled constraints; mapping this to host `ask` would
    // incorrectly widen execution (user could approve without constraint checks). Reject.
    return {
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          response.review_decision?.reason ??
          'local review required constraints that the hook runtime cannot enforce',
      },
    };
  }

  if (decision === 'deny') {
    return {
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: response.review_decision?.reason ?? 'local review denied',
      },
    };
  }

  if (decision === 'ask') {
    return {
      continue: false,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: response.review_decision?.reason ?? 'local review requested confirmation',
      },
    };
  }

  return {
    continue: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'unexpected review response',
    },
  };
}
