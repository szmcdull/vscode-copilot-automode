import type { SessionStore } from './sessionStore.js';
import type { UserPromptSubmitPayload } from './types.js';

export function createUserPromptSubmitHandler(store: SessionStore) {
  return async (payload: UserPromptSubmitPayload) => {
    await store.put({
      sessionId: payload.session_id,
      prompt: payload.prompt,
      cwd: payload.cwd,
      transcriptPath: payload.transcript_path,
      storedAt: payload.timestamp,
    });

    return { continue: true };
  };
}
