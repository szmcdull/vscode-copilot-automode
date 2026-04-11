export interface UserPromptSubmitPayload {
  session_id: string;
  prompt: string;
  cwd: string;
  transcript_path?: string;
  timestamp: string;
}

export interface PreToolUsePayload {
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  cwd: string;
  timestamp: string;
  tool_input: Record<string, unknown>;
  transcript_path?: string;
}

export interface PostToolUsePayload {
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  cwd: string;
  timestamp: string;
  tool_response?: unknown;
}

export function assertUserPromptSubmitPayload(payload: unknown): UserPromptSubmitPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('invalid UserPromptSubmit payload');
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.session_id !== 'string' ||
    typeof p.prompt !== 'string' ||
    typeof p.cwd !== 'string' ||
    typeof p.timestamp !== 'string' ||
    (p.transcript_path !== undefined && typeof p.transcript_path !== 'string')
  ) {
    throw new Error('invalid UserPromptSubmit payload');
  }
  return {
    session_id: p.session_id,
    prompt: p.prompt,
    cwd: p.cwd,
    transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : undefined,
    timestamp: p.timestamp,
  };
}

export function assertPreToolUsePayload(payload: unknown): PreToolUsePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('invalid PreToolUse payload');
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.session_id !== 'string' ||
    typeof p.tool_name !== 'string' ||
    typeof p.tool_use_id !== 'string' ||
    typeof p.cwd !== 'string' ||
    typeof p.timestamp !== 'string' ||
    typeof p.tool_input !== 'object' ||
    p.tool_input === null ||
    Array.isArray(p.tool_input)
  ) {
    throw new Error('invalid PreToolUse payload');
  }
  return {
    session_id: p.session_id,
    tool_name: p.tool_name,
    tool_use_id: p.tool_use_id,
    cwd: p.cwd,
    timestamp: p.timestamp,
    tool_input: p.tool_input as Record<string, unknown>,
    transcript_path: typeof p.transcript_path === 'string' ? p.transcript_path : undefined,
  };
}

export function assertPostToolUsePayload(payload: unknown): PostToolUsePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('invalid PostToolUse payload');
  }
  const p = payload as Record<string, unknown>;
  if (
    typeof p.session_id !== 'string' ||
    typeof p.tool_name !== 'string' ||
    typeof p.tool_use_id !== 'string' ||
    typeof p.cwd !== 'string' ||
    typeof p.timestamp !== 'string'
  ) {
    throw new Error('invalid PostToolUse payload');
  }
  return {
    session_id: p.session_id,
    tool_name: p.tool_name,
    tool_use_id: p.tool_use_id,
    cwd: p.cwd,
    timestamp: p.timestamp,
    tool_response: p.tool_response,
  };
}
