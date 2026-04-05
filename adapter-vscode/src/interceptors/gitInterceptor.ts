import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import type { NormalizedEffects, OperationRequest, PermissionKind, SourceKind } from '../protocol/types.js';

export interface GitInterceptorOptions {
  source: SourceKind;
}

export interface GitInterceptEvent {
  id: string;
  session: string;
  workspace: string;
  argv: string[];
  timestamp: string;
  mutating: boolean;
  fullyObserved: boolean;
  intent?: string;
}

export interface InterceptorResult {
  request: OperationRequest;
  routing: OperationRoutingInput;
  decisionHandlingPath: 'invoke_review_service' | 'degrade_to_ask';
  degradeReason?: string;
}

export function createGitInterceptor(options: GitInterceptorOptions) {
  return {
    intercept(event: GitInterceptEvent): InterceptorResult {
      const normalizedEffects: NormalizedEffects = {};
      const requestedPermissions: PermissionKind[] = [];

      if (event.mutating) {
        normalizedEffects.may_mutate_git_history = true;
        requestedPermissions.push('git_mutation');
      }

      const request: OperationRequest = {
        id: event.id,
        source: options.source,
        session: event.session,
        workspace: event.workspace,
        tool: 'git',
        category: 'git',
        intent: event.intent,
        arguments: {
          argv: event.argv,
          command: event.argv.join(' '),
        },
        normalized_effects: normalizedEffects,
        requested_permissions: requestedPermissions,
        risk_signals: {},
        timestamp: event.timestamp,
      };

      return {
        request,
        routing: { wouldUseAiReview: true, wouldStaticAutoApprove: false },
        decisionHandlingPath: event.fullyObserved ? 'invoke_review_service' : 'degrade_to_ask',
        degradeReason: event.fullyObserved ? undefined : 'partially_observed_operation',
      };
    },
  };
}
