import type { OperationRequest, ReviewHTTPResponse } from '../protocol/types.js';
import type { OperationRoutingInput } from '../safeMode/safeModeController.js';
import { normalizeOperationRequest } from '../normalizers/operationRequest.js';
import type { SessionStore } from './sessionStore.js';
import type { PreToolUsePayload } from './types.js';
import { mapReviewHttpResponseToPreToolUseHook } from './reviewMapping.js';
export { CANONICAL_SHELL_TOOL_NAME, RUN_IN_TERMINAL_TOOL_NAME } from '../shared/toolNames.js';
import { CANONICAL_SHELL_TOOL_NAME, RUN_IN_TERMINAL_TOOL_NAME } from '../shared/toolNames.js';

/** Distinguishes a persisted local review session from older remote-service shapes. */
export type ReviewResultKind = 'local_review';

export interface ToolUseLinkData {
  requestId: string;
  /** True when PreToolUse received server `ask_pending`; PostToolUse must call submitUserDecision before observation. */
  needsUserDecisionApprove: boolean;
  /** Source of the review-shaped outcome; safe-mode fallback has no server-backed session. */
  reviewResultKind: ReviewResultKind;
}

export interface ToolUseLinkStore {
  put(
    toolUseId: string,
    requestId: string,
    sessionId: string,
    options?: { needsUserDecisionApprove?: boolean; reviewResultKind?: ReviewResultKind },
  ): Promise<void>;
  getLink(toolUseId: string, sessionId: string): Promise<ToolUseLinkData | null>;
  getRequestId(toolUseId: string, sessionId: string): Promise<string | null>;
  /** Persist that user approve was sent so PostToolUse retries do not call approve again. */
  markUserDecisionSubmitted(toolUseId: string, sessionId: string): Promise<void>;
  consumeRequestId(toolUseId: string, sessionId: string): Promise<string | null>;
}

export interface CreatePreToolUseHandlerOptions {
  reviewClient: {
    review(request: OperationRequest, routing: OperationRoutingInput): Promise<{ response: ReviewHTTPResponse }>;
  };
  sessionStore: Pick<SessionStore, 'get'>;
  now: () => string;
  requestId: () => string;
  linkStore?: ToolUseLinkStore;
  /**
   * Routing flags for safe-mode resolution; hooks use a non-AI blind review path by default.
   */
  routing?: OperationRoutingInput;
}

function stringField(toolInput: Record<string, unknown>, key: string): string | undefined {
  const v = toolInput[key];
  return typeof v === 'string' ? v : undefined;
}

function buildShellOperationRequest(
  payload: PreToolUsePayload,
  deps: CreatePreToolUseHandlerOptions,
  promptContext: Awaited<ReturnType<SessionStore['get']>>,
): OperationRequest {
  const goal = stringField(payload.tool_input, 'goal');
  const command = stringField(payload.tool_input, 'command');
  const explanation = stringField(payload.tool_input, 'explanation');
  const intent = promptContext?.prompt ?? goal ?? command ?? '';
  const workspace = promptContext?.cwd ?? payload.cwd;

  const modelContext = {
    user_prompt: promptContext?.prompt ?? null,
    transcript_path: payload.transcript_path ?? promptContext?.transcriptPath ?? null,
    hook_tool_use_id: payload.tool_use_id,
    host_tool_name: payload.tool_name,
    host_tool_goal: goal ?? null,
    host_tool_explanation: explanation ?? null,
    hook_cwd: payload.cwd,
    hook_tool_input: payload.tool_input,
  };

  return normalizeOperationRequest({
    id: deps.requestId(),
    source: 'vscode',
    session: payload.session_id,
    workspace,
    tool: CANONICAL_SHELL_TOOL_NAME,
    category: 'shell',
    intent,
    arguments: {
      command: command ?? '',
      goal,
      explanation,
      host_tool_name: payload.tool_name,
    },
    modelContext,
    timestamp: payload.timestamp,
    cwd: payload.cwd,
  });
}

export function createPreToolUseHandler(deps: CreatePreToolUseHandlerOptions) {
  const routing: OperationRoutingInput = deps.routing ?? {
    wouldUseAiReview: true,
    wouldStaticAutoApprove: false,
  };

  return async (payload: PreToolUsePayload) => {
    if (payload.tool_name !== RUN_IN_TERMINAL_TOOL_NAME) {
      return { continue: true };
    }

    const promptContext = await deps.sessionStore.get(payload.session_id);
    const request = buildShellOperationRequest(payload, deps, promptContext);

    const result = await deps.reviewClient.review(request, routing);
    const response = result.response;
    const reviewResultKind: ReviewResultKind = 'local_review';

    if (deps.linkStore) {
      await deps.linkStore.put(payload.tool_use_id, response.request_id, payload.session_id, {
        needsUserDecisionApprove: response.status === 'ask_pending',
        reviewResultKind,
      });
    }

    return mapReviewHttpResponseToPreToolUseHook(response);
  };
}
