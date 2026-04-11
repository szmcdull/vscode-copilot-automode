import type { PreToolUseHookResult } from '../../shared/src/preToolUseHookResult.js';

export interface CursorPermissionHookOutput {
  permission: 'allow' | 'deny';
  agentMessage?: string;
  user_message?: string;
}

export function preToolUseResultToCursorPermission(result: unknown): CursorPermissionHookOutput {
  const r = result as PreToolUseHookResult;
  if (r && typeof r === 'object' && r.continue === true) {
    return { permission: 'allow' };
  }

  const decision = r?.hookSpecificOutput?.permissionDecision;
  const reason = r?.hookSpecificOutput?.permissionDecisionReason;

  if (decision === 'allow') {
    return { permission: 'allow' };
  }

  if (decision === 'ask') {
    return {
      permission: 'deny',
      agentMessage: reason ?? 'Auto Mode requested confirmation, but Cursor CLI has no ask UI.',
    };
  }

  return {
    permission: 'deny',
    agentMessage: reason ?? 'Auto Mode denied this tool use',
  };
}

export function buildDryRunCursorPermission(input: {
  event: string;
  cwd: string;
  command: string;
  decision: 'allow' | 'deny';
}): CursorPermissionHookOutput {
  const max = 160;
  const command = input.command.length > max ? `${input.command.slice(0, max)}…` : input.command;
  return {
    permission: input.decision,
    agentMessage: `Auto Mode dry-run: event=${input.event}; cwd=${input.cwd}; command=${command}`,
  };
}
