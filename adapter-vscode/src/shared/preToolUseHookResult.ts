export interface PreToolUseHookSpecificOutput {
  hookEventName: 'PreToolUse';
  permissionDecision: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
}

export interface PreToolUseHookResult {
  continue: boolean;
  hookSpecificOutput?: PreToolUseHookSpecificOutput;
}
