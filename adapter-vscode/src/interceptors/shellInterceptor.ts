import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import type { OperationRequest, SourceKind } from '../protocol/types.js';
import { normalizeOperationRequest } from '../normalizers/operationRequest.js';

export interface ShellInterceptorOptions {
  source: SourceKind;
}

export interface ShellInterceptEvent {
  id: string;
  session: string;
  workspace: string;
  command: string[];
  cwd?: string;
  readPaths?: string[];
  writePaths?: string[];
  deletePaths?: string[];
  timestamp: string;
  intent?: string;
}

export interface InterceptorResult {
  request: OperationRequest;
  routing: OperationRoutingInput;
  decisionHandlingPath: 'invoke_review_service' | 'degrade_to_ask';
  degradeReason?: string;
}

export function createShellInterceptor(options: ShellInterceptorOptions) {
  return {
    intercept(event: ShellInterceptEvent): InterceptorResult {
      const request = normalizeOperationRequest({
        id: event.id,
        source: options.source,
        session: event.session,
        workspace: event.workspace,
        tool: 'run_terminal_cmd',
        category: 'shell',
        intent: event.intent,
        arguments: {
          command: event.command.join(' '),
          argv: event.command,
        },
        timestamp: event.timestamp,
        cwd: event.cwd,
        readPaths: event.readPaths,
        writePaths: event.writePaths,
        deletePaths: event.deletePaths,
      });

      return {
        request,
        routing: { wouldUseAiReview: true, wouldStaticAutoApprove: false },
        decisionHandlingPath: 'invoke_review_service',
      };
    },
  };
}
