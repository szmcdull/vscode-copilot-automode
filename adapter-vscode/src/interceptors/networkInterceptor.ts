import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import type { OperationRequest, SourceKind } from '../protocol/types.js';

export interface NetworkInterceptorOptions {
  source: SourceKind;
}

export interface NetworkInterceptEvent {
  id: string;
  session: string;
  workspace: string;
  url: string;
  method: string;
  timestamp: string;
  fullyObserved: boolean;
  intent?: string;
}

export interface InterceptorResult {
  request: OperationRequest;
  routing: OperationRoutingInput;
  decisionHandlingPath: 'invoke_review_service' | 'degrade_to_ask';
  degradeReason?: string;
}

export function createNetworkInterceptor(options: NetworkInterceptorOptions) {
  return {
    intercept(event: NetworkInterceptEvent): InterceptorResult {
      const request: OperationRequest = {
        id: event.id,
        source: options.source,
        session: event.session,
        workspace: event.workspace,
        tool: 'network.fetch',
        category: 'network',
        intent: event.intent,
        arguments: {
          url: event.url,
          method: event.method,
        },
        normalized_effects: { may_use_network: true },
        requested_permissions: ['network_egress'],
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
