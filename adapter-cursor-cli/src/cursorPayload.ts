import { randomUUID } from 'node:crypto';

import {
  assertPreToolUsePayload,
  type PreToolUsePayload,
} from '../../shared/src/hookPayloads.js';
import { RUN_IN_TERMINAL_TOOL_NAME } from '../../shared/src/toolNames.js';

export type CursorHookEventName = 'beforeShellExecution' | 'preToolUse';

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function extractShellCommandFromCursorPayload(payload: Record<string, unknown>): string {
  const direct = pickString(payload, ['command', 'shellCommand', 'shell_command', 'fullCommand', 'line']);
  if (direct !== undefined) return direct;

  const toolInput = asRecord(payload.tool_input) ?? asRecord(payload.toolInput);
  if (toolInput) {
    const nested = pickString(toolInput, ['command', 'cmd', 'script']);
    if (nested !== undefined) return nested;
  }

  const args = payload.arguments;
  if (asRecord(args)) {
    const nested = pickString(args as Record<string, unknown>, ['command', 'cmd']);
    if (nested !== undefined) return nested;
  }

  return '';
}

function normalizeToolName(raw: string | undefined): string {
  if (!raw) return '';
  const t = raw.trim();
  if (t === 'Shell' || t === 'shell' || t === 'Bash' || t === 'bash' || t === 'run_terminal_cmd') {
    return RUN_IN_TERMINAL_TOOL_NAME;
  }
  return t;
}

export function cursorPayloadToPreToolUse(
  cursorEvent: CursorHookEventName,
  raw: unknown,
  nowIso: () => string = () => new Date().toISOString(),
): PreToolUsePayload {
  const p = asRecord(raw);
  if (!p) {
    throw new Error('cursor hook payload must be a JSON object');
  }

  const cwd = pickString(p, ['cwd', 'workspaceRoot', 'workspace_root']) ?? process.cwd();
  const session_id =
    pickString(p, ['session_id', 'sessionId', 'conversation_id', 'conversationId']) ?? 'cursor-session';
  const tool_use_id = pickString(p, ['tool_use_id', 'toolUseId', 'id']) ?? `cursor-${randomUUID()}`;
  const timestamp = pickString(p, ['timestamp']) ?? nowIso();

  if (cursorEvent === 'beforeShellExecution') {
    return assertPreToolUsePayload({
      session_id,
      tool_use_id,
      cwd,
      timestamp,
      tool_name: RUN_IN_TERMINAL_TOOL_NAME,
      tool_input: {
        command: extractShellCommandFromCursorPayload(p),
        goal: pickString(p, ['goal']) ?? '',
        explanation: pickString(p, ['explanation']) ?? '',
      },
      transcript_path: pickString(p, ['transcript_path', 'transcriptPath']),
    });
  }

  const maybe = { ...p } as Record<string, unknown>;
  if (typeof maybe.tool_name === 'string') {
    maybe.tool_name = normalizeToolName(maybe.tool_name);
  }
  if (typeof maybe.toolName === 'string') {
    maybe.tool_name = normalizeToolName(maybe.toolName);
    delete maybe.toolName;
  }
  if (typeof maybe.sessionId === 'string' && maybe.session_id === undefined) {
    maybe.session_id = maybe.sessionId;
    delete maybe.sessionId;
  }
  if (typeof maybe.toolUseId === 'string' && maybe.tool_use_id === undefined) {
    maybe.tool_use_id = maybe.toolUseId;
    delete maybe.toolUseId;
  }
  if (maybe.tool_input === undefined && maybe.toolInput !== undefined) {
    maybe.tool_input = maybe.toolInput;
    delete maybe.toolInput;
  }

  const toolInput = asRecord(maybe.tool_input);
  if (maybe.tool_name === RUN_IN_TERMINAL_TOOL_NAME && toolInput) {
    maybe.tool_input = {
      ...toolInput,
      command: pickString(toolInput, ['command', 'cmd']) ?? extractShellCommandFromCursorPayload({ ...maybe, tool_input: toolInput }),
    };
  }

  try {
    return assertPreToolUsePayload(maybe);
  } catch {
    return assertPreToolUsePayload({
      session_id,
      tool_use_id,
      cwd,
      timestamp,
      tool_name: normalizeToolName(pickString(p, ['tool_name', 'toolName', 'tool'])) || RUN_IN_TERMINAL_TOOL_NAME,
      tool_input: {
        command: extractShellCommandFromCursorPayload(p),
        goal: pickString(p, ['goal']) ?? '',
        explanation: pickString(p, ['explanation']) ?? '',
      },
      transcript_path: pickString(p, ['transcript_path', 'transcriptPath']),
    });
  }
}
