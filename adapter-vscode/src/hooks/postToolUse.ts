import { RUN_IN_TERMINAL_TOOL_NAME } from './preToolUse.js';
import type { ToolUseLinkStore } from './preToolUse.js';
import type { PostToolUsePayload } from './types.js';

export interface PostToolUseDeps {
  linkStore: Pick<ToolUseLinkStore, 'getLink' | 'consumeRequestId' | 'markUserDecisionSubmitted'>;
}

export function createPostToolUseHandler(deps: PostToolUseDeps) {
  return async (payload: PostToolUsePayload) => {
    if (payload.tool_name !== RUN_IN_TERMINAL_TOOL_NAME) {
      return { continue: true };
    }

    const link = await deps.linkStore.getLink(payload.tool_use_id, payload.session_id);
    if (!link) {
      return { continue: true };
    }

    await deps.linkStore.consumeRequestId(payload.tool_use_id, payload.session_id);

    return { continue: true };
  };
}
