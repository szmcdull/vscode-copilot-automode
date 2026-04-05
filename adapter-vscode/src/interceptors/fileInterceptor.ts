import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import type { OperationRequest, SourceKind } from '../protocol/types.js';
import { normalizeOperationRequest } from '../normalizers/operationRequest.js';

export interface FileInterceptorOptions {
  source: SourceKind;
}

export interface FileInterceptEvent {
  id: string;
  session: string;
  workspace: string;
  path: string;
  contentsPreview?: string;
  timestamp: string;
  intent?: string;
  mode?: 'write' | 'edit';
}

export interface InterceptorResult {
  request: OperationRequest;
  routing: OperationRoutingInput;
  decisionHandlingPath: 'invoke_review_service' | 'degrade_to_ask';
  degradeReason?: string;
}

export function createFileInterceptor(options: FileInterceptorOptions) {
  return {
    intercept(event: FileInterceptEvent): InterceptorResult {
      const request = normalizeOperationRequest({
        id: event.id,
        source: options.source,
        session: event.session,
        workspace: event.workspace,
        tool: event.mode === 'edit' ? 'edit_file' : 'write_file',
        category: event.mode === 'edit' ? 'file_edit' : 'file_write',
        intent: event.intent,
        arguments: {
          path: event.path,
          content_preview: event.contentsPreview,
        },
        timestamp: event.timestamp,
        targetPath: event.path,
      });

      return {
        request,
        routing: { wouldUseAiReview: true, wouldStaticAutoApprove: false },
        decisionHandlingPath: 'invoke_review_service',
      };
    },
  };
}
