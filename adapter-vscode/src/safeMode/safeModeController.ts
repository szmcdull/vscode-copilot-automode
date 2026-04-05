export type SafeModeEvent =
  | { type: 'failure_recorded'; consecutiveFailures: number; threshold: number }
  | { type: 'entered_safe_mode'; reason: string; consecutiveFailures: number }
  | { type: 'success_recorded'; consecutiveFailures: number }
  | { type: 'exited_safe_mode'; reason: string };

export interface OperationRoutingInput {
  /** Would normally take the AI review branch (needs review service + AI). */
  wouldUseAiReview: boolean;
  /**
   * Policy would auto-approve without user prompt (static high-trust path).
   * Must not be honored as automatic allow while safe mode is active.
   */
  wouldStaticAutoApprove: boolean;
}

export interface ResolveResult {
  effectiveHandling: 'ask' | 'invoke_review_service';
  downgraded?: boolean;
  reason?: string;
}

export interface SafeModeControllerOptions {
  failureThreshold: number;
}

const DEFAULT_THRESHOLD = 3;

export class SafeModeController {
  private readonly failureThreshold: number;
  private consecutiveFailures = 0;
  private safeMode = false;

  constructor(options: Partial<SafeModeControllerOptions> = {}) {
    const threshold = options.failureThreshold ?? DEFAULT_THRESHOLD;
    this.failureThreshold = threshold >= 1 ? threshold : DEFAULT_THRESHOLD;
  }

  isInSafeMode(): boolean {
    return this.safeMode;
  }

  recordReviewServiceFailure(): SafeModeEvent {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      const wasAlreadyInSafeMode = this.safeMode;
      this.safeMode = true;
      if (!wasAlreadyInSafeMode) {
        return {
          type: 'entered_safe_mode',
          reason: `review_service_failures_reached_threshold_${this.failureThreshold}`,
          consecutiveFailures: this.consecutiveFailures,
        };
      }
    }
    return {
      type: 'failure_recorded',
      consecutiveFailures: this.consecutiveFailures,
      threshold: this.failureThreshold,
    };
  }

  recordReviewServiceSuccess(): SafeModeEvent {
    const wasInSafeMode = this.safeMode;
    this.consecutiveFailures = 0;
    if (wasInSafeMode) {
      this.safeMode = false;
      return {
        type: 'exited_safe_mode',
        reason: 'review_service_recovered',
      };
    }
    return {
      type: 'success_recorded',
      consecutiveFailures: 0,
    };
  }

  resolveModeForOperation(input: OperationRoutingInput): ResolveResult {
    if (!this.safeMode) {
      return { effectiveHandling: 'invoke_review_service', downgraded: false };
    }
    if (input.wouldUseAiReview || input.wouldStaticAutoApprove) {
      return {
        effectiveHandling: 'ask',
        downgraded: true,
        reason: 'safe_mode_degraded_high_trust_paths_to_ask',
      };
    }
    return { effectiveHandling: 'invoke_review_service', downgraded: false };
  }
}
