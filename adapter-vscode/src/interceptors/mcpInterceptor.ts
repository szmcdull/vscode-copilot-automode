import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import type { OperationRequest, SourceKind } from '../protocol/types.js';
import { normalizeOperationRequest } from '../normalizers/operationRequest.js';

export interface McpInterceptorOptions {
  source: SourceKind;
}

export interface McpInterceptEvent {
  id: string;
  session: string;
  workspace: string;
  toolName: string;
  arguments?: unknown;
  timestamp: string;
  knownTool: boolean;
  fullyObserved: boolean;
  intent?: string;
}

export interface InterceptorResult {
  request: OperationRequest;
  routing: OperationRoutingInput;
  decisionHandlingPath: 'invoke_review_service' | 'degrade_to_ask';
  degradeReason?: string;
}

export function createMcpInterceptor(options: McpInterceptorOptions) {
  return {
    intercept(event: McpInterceptEvent): InterceptorResult {
      const request = normalizeOperationRequest({
        id: event.id,
        source: options.source,
        session: event.session,
        workspace: event.workspace,
        tool: event.toolName,
        category: 'mcp',
        intent: event.intent,
        arguments: event.arguments,
        timestamp: event.timestamp,
        knownMcpTool: event.knownTool,
      });

      const degradeReason =
        !event.fullyObserved ? 'partially_observed_operation' : !event.knownTool ? 'unknown_mcp_tool' : undefined;

      return {
        request,
        routing: { wouldUseAiReview: true, wouldStaticAutoApprove: false },
        decisionHandlingPath: degradeReason ? 'degrade_to_ask' : 'invoke_review_service',
        degradeReason,
      };
    },
  };
}
