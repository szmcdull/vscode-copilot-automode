export type {
  PostToolUsePayload,
  PreToolUsePayload,
  UserPromptSubmitPayload,
} from '../shared/hookPayloads.js';
export {
  assertPostToolUsePayload,
  assertPreToolUsePayload,
  assertUserPromptSubmitPayload,
} from '../shared/hookPayloads.js';

import type {
  PostToolUsePayload,
  PreToolUsePayload,
  UserPromptSubmitPayload,
} from '../shared/hookPayloads.js';

export interface HookCliDeps {
  userPromptSubmit: (payload: UserPromptSubmitPayload) => Promise<unknown>;
  preToolUse: (payload: PreToolUsePayload) => Promise<unknown>;
  postToolUse: (payload: PostToolUsePayload) => Promise<unknown>;
}

/** HTTP bridge client used by `createHookCliDepsFromBridge` (extension host publishes manifest + port). */
export interface BridgeHookClient {
  invoke(event: string, payload: unknown): Promise<unknown>;
}
