import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isAskChallenge,
  isOperationRequest,
  isReviewDecision,
} from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const autoModeRoot = path.resolve(here, '..', '..', '..');

function readJSON(relativePath: string): unknown {
  const full = path.join(autoModeRoot, relativePath);
  return JSON.parse(readFileSync(full, 'utf8')) as unknown;
}

describe('protocol mirror validation against frozen fixtures', () => {
  it('accepts a frozen OperationRequest fixture', () => {
    const value = readJSON('fixtures/requests/ai-review-shell-op.json');
    expect(isOperationRequest(value)).toBe(true);
  });

  it('accepts frozen ReviewDecision fixtures from audit records', () => {
    const completed = readJSON('fixtures/decisions/audit-completed.json') as {
      audit: { final_decision: unknown; planned_decision?: never };
      planned_decision: unknown;
      effective_decision: unknown;
    };
    expect(isReviewDecision(completed.audit.final_decision)).toBe(true);
    expect(isReviewDecision(completed.planned_decision)).toBe(true);
    expect(isReviewDecision(completed.effective_decision)).toBe(true);
  });

  it('accepts a minimal AskChallenge wire shape used by the adapter fallback path', () => {
    const ask = {
      request_id: 'req-1',
      prompt_text: 'Proceed?',
      review_snapshot: {
        decision: 'ask',
        reason: 'safe mode',
        risk_level: 'high',
        trace: {},
      },
      decision_context: {
        current_review_snapshot: {
          decision: 'ask',
          reason: 'safe mode',
          risk_level: 'high',
          trace: {},
        },
        matched_risk_labels: [],
        overridable_permissions: [],
        hard_boundary_summary: 'summary',
      },
      allowed_user_actions: ['approve', 'deny', 'cancel'],
      timeout_behavior: 'deny',
    };
    expect(isAskChallenge(ask)).toBe(true);
  });
});
