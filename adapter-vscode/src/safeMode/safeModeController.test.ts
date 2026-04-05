import { describe, expect, it } from 'vitest';
import { SafeModeController } from './safeModeController.js';

describe('SafeModeController', () => {
  const threshold = 3;

  it('enters safe mode after consecutive review-service failures reach threshold', () => {
    const c = new SafeModeController({ failureThreshold: threshold });
    expect(c.isInSafeMode()).toBe(false);

    const e1 = c.recordReviewServiceFailure();
    expect(e1.type).toBe('failure_recorded');
    expect(c.isInSafeMode()).toBe(false);

    const e2 = c.recordReviewServiceFailure();
    expect(e2.type).toBe('failure_recorded');
    expect(c.isInSafeMode()).toBe(false);

    const e3 = c.recordReviewServiceFailure();
    expect(e3.type).toBe('entered_safe_mode');
    expect(c.isInSafeMode()).toBe(true);
    if (e3.type === 'entered_safe_mode') {
      expect(e3.reason).toMatch(/threshold/i);
      expect(e3.consecutiveFailures).toBe(threshold);
    }
  });

  it('resets failure count on successful review-service response', () => {
    const c = new SafeModeController({ failureThreshold: threshold });
    c.recordReviewServiceFailure();
    c.recordReviewServiceFailure();

    const ok = c.recordReviewServiceSuccess();
    expect(ok.type).toBe('success_recorded');
    if (ok.type === 'success_recorded') {
      expect(ok.consecutiveFailures).toBe(0);
    }
    expect(c.isInSafeMode()).toBe(false);

    c.recordReviewServiceFailure();
    c.recordReviewServiceFailure();
    expect(c.isInSafeMode()).toBe(false);

    c.recordReviewServiceFailure();
    expect(c.isInSafeMode()).toBe(true);
  });

  it('in safe mode, downgrades operations that would use AI review to ask', () => {
    const c = new SafeModeController({ failureThreshold: 1 });
    c.recordReviewServiceFailure();

    const r = c.resolveModeForOperation({
      wouldUseAiReview: true,
      wouldStaticAutoApprove: false,
    });
    expect(r.effectiveHandling).toBe('ask');
    expect(r.downgraded).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it('in safe mode, does not let static auto-approved high-permission work proceed as auto — forces ask', () => {
    const c = new SafeModeController({ failureThreshold: 1 });
    c.recordReviewServiceFailure();

    const r = c.resolveModeForOperation({
      wouldUseAiReview: false,
      wouldStaticAutoApprove: true,
    });
    expect(r.effectiveHandling).toBe('ask');
    expect(r.downgraded).toBe(true);
  });

  it('exits safe mode after a successful review-service response (recovery)', () => {
    const c = new SafeModeController({ failureThreshold: 2 });
    c.recordReviewServiceFailure();
    c.recordReviewServiceFailure();
    expect(c.isInSafeMode()).toBe(true);

    const exit = c.recordReviewServiceSuccess();
    expect(exit.type).toBe('exited_safe_mode');
    expect(c.isInSafeMode()).toBe(false);
    if (exit.type === 'exited_safe_mode') {
      expect(exit.reason).toBeTruthy();
    }

    const after = c.resolveModeForOperation({
      wouldUseAiReview: true,
      wouldStaticAutoApprove: false,
    });
    expect(after.effectiveHandling).toBe('invoke_review_service');
    expect(after.downgraded).toBe(false);
  });

  it('when not in safe mode, forwards AI-reviewed operations to review service path', () => {
    const c = new SafeModeController({ failureThreshold: 5 });
    const r = c.resolveModeForOperation({
      wouldUseAiReview: true,
      wouldStaticAutoApprove: false,
    });
    expect(r.effectiveHandling).toBe('invoke_review_service');
    expect(r.downgraded).toBe(false);
  });

  it('in safe mode, does not downgrade operations that are outside auto-reviewed and static-auto-approved paths', () => {
    const c = new SafeModeController({ failureThreshold: 1 });
    c.recordReviewServiceFailure();

    const r = c.resolveModeForOperation({
      wouldUseAiReview: false,
      wouldStaticAutoApprove: false,
    });
    expect(r.effectiveHandling).toBe('invoke_review_service');
    expect(r.downgraded).toBe(false);
  });

  it('normalizes invalid failure thresholds back to the default threshold', () => {
    const c = new SafeModeController({ failureThreshold: 0 });
    expect(c.isInSafeMode()).toBe(false);
    c.recordReviewServiceFailure();
    c.recordReviewServiceFailure();
    expect(c.isInSafeMode()).toBe(false);
    c.recordReviewServiceFailure();
    expect(c.isInSafeMode()).toBe(true);
  });
});
