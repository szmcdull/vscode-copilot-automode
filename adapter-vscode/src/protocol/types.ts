/**
 * Local protocol mirror used by the adapter review engine, hook bridge, and tests.
 * Field names stay in snake_case for hook/runtime interchange.
 */

// ---- Enums (frozen string tokens for local protocol interchange) ----

export type ReviewDecisionKind =
  | 'allow'
  | 'deny'
  | 'ask'
  | 'allow_with_constraints';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type SourceKind = 'cursor' | 'vscode' | 'cli' | 'mcp' | 'custom';

export type OperationCategory =
  | 'shell'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'git'
  | 'network'
  | 'browser'
  | 'mcp'
  | 'task'
  | 'custom_tool';

export type PermissionKind =
  | 'filesystem_write'
  | 'filesystem_delete'
  | 'shell_execute'
  | 'network_egress'
  | 'git_mutation'
  | 'mcp_external'
  | 'process_spawn'
  | 'credential_access'
  | 'workspace_escape';

export type RiskLabel =
  | 'touches_sensitive_file'
  | 'outside_workspace'
  | 'workspace_escape'
  | 'destructive_delete'
  | 'git_history_mutation'
  | 'untrusted_network'
  | 'unknown_mcp_tool'
  | 'credential_surface'
  | 'credential_access';

export type UserAction =
  | 'approve'
  | 'deny'
  | 'cancel'
  | 'provide_context';

export type AskTimeoutBehavior = 'deny' | 'cancel';

/** VSCode Claude-format PreToolUse hook JSON (stdout), not the internal bridge payload. */
export interface PreToolUseHookSpecificOutput {
  hookEventName: 'PreToolUse';
  permissionDecision: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
}

export interface PreToolUseHookResult {
  continue: boolean;
  hookSpecificOutput?: PreToolUseHookSpecificOutput;
}

/** Local review session status used by the adapter test/runtime mirrors. */
export type ReviewSessionStatus = 'final' | 'ask_pending';

export interface NormalizedEffects {
  path_read_patterns?: string[];
  path_write_patterns?: string[];
  may_delete_files?: boolean;
  escapes_workspace?: boolean;
  may_use_network?: boolean;
  may_mutate_git_history?: boolean;
  may_spawn_process?: boolean;
  touches_credentials?: boolean;
}

/**
 * Unified operation request used by interceptors and hook review shaping.
 * `arguments`, `model_context`, `risk_signals` are opaque JSON on the wire.
 */
export interface OperationRequest {
  id: string;
  source: SourceKind;
  session: string;
  workspace: string;
  tool: string;
  category: OperationCategory;
  intent?: string;
  arguments?: unknown;
  normalized_effects: NormalizedEffects;
  requested_permissions: PermissionKind[];
  model_context?: unknown;
  risk_signals?: unknown;
  /** ISO-8601 timestamp string. */
  timestamp: string;
}

export interface ConstraintSet {
  path_allowlist?: string[];
  path_denylist?: string[];
  workspace_only?: boolean;
  allowed_modify_paths?: string[];
  forbid_delete?: boolean;
  host_allowlist?: string[];
  command_template_allowlist?: string[];
  git_read_only?: boolean;
}

export interface ReviewDecision {
  decision: ReviewDecisionKind;
  reason: string;
  risk_level: RiskLevel;
  constraints?: ConstraintSet;
  /** Required on wire; arbitrary JSON object. */
  trace: unknown;
}

export interface AskDecisionContext {
  current_review_snapshot: ReviewDecision;
  matched_risk_labels: RiskLabel[];
  overridable_permissions: PermissionKind[];
  hard_boundary_summary: string;
}

export interface AskChallenge {
  request_id: string;
  prompt_text: string;
  review_snapshot: ReviewDecision;
  decision_context: AskDecisionContext;
  allowed_user_actions: UserAction[];
  timeout_behavior: AskTimeoutBehavior;
}

/** Local review response shape used by mapping helpers and tests. */
export interface ReviewHTTPResponse {
  request_id: string;
  status: ReviewSessionStatus;
  review_decision?: ReviewDecision;
  ask_challenge?: AskChallenge;
  adapter_identity: string;
}

const REVIEW_DECISIONS = new Set<ReviewDecisionKind>([
  'allow',
  'deny',
  'ask',
  'allow_with_constraints',
]);
const RISK_LEVELS = new Set<RiskLevel>(['low', 'medium', 'high', 'critical']);
const SOURCE_KINDS = new Set<SourceKind>(['cursor', 'vscode', 'cli', 'mcp', 'custom']);
const OPERATION_CATEGORIES = new Set<OperationCategory>([
  'shell',
  'file_read',
  'file_write',
  'file_edit',
  'git',
  'network',
  'browser',
  'mcp',
  'task',
  'custom_tool',
]);
const PERMISSION_KINDS = new Set<PermissionKind>([
  'filesystem_write',
  'filesystem_delete',
  'shell_execute',
  'network_egress',
  'git_mutation',
  'mcp_external',
  'process_spawn',
  'credential_access',
  'workspace_escape',
]);
const RISK_LABELS = new Set<RiskLabel>([
  'touches_sensitive_file',
  'outside_workspace',
  'workspace_escape',
  'destructive_delete',
  'git_history_mutation',
  'untrusted_network',
  'unknown_mcp_tool',
  'credential_surface',
  'credential_access',
]);
const USER_ACTIONS = new Set<UserAction>(['approve', 'deny', 'cancel', 'provide_context']);
const ASK_TIMEOUT_BEHAVIORS = new Set<AskTimeoutBehavior>(['deny', 'cancel']);
const REVIEW_SESSION_STATUSES = new Set<ReviewSessionStatus>(['final', 'ask_pending']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Minimal runtime validation helpers used by adapter tests to keep this mirror aligned.
 */
export function isOperationRequest(value: unknown): value is OperationRequest {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.source === 'string' &&
    SOURCE_KINDS.has(value.source as SourceKind) &&
    typeof value.session === 'string' &&
    typeof value.workspace === 'string' &&
    typeof value.tool === 'string' &&
    typeof value.category === 'string' &&
    OPERATION_CATEGORIES.has(value.category as OperationCategory) &&
    Array.isArray(value.requested_permissions) &&
    value.requested_permissions.every(
      (entry) => typeof entry === 'string' && PERMISSION_KINDS.has(entry as PermissionKind),
    ) &&
    typeof value.timestamp === 'string' &&
    isObject(value.normalized_effects)
  );
}

export function isReviewHTTPResponse(value: unknown): value is ReviewHTTPResponse {
  if (!isObject(value)) return false;
  if (
    typeof value.request_id !== 'string' ||
    typeof value.status !== 'string' ||
    !REVIEW_SESSION_STATUSES.has(value.status as ReviewSessionStatus) ||
    typeof value.adapter_identity !== 'string'
  ) {
    return false;
  }
  if (
    'review_decision' in value &&
    value.review_decision !== undefined &&
    !isReviewDecision(value.review_decision)
  ) {
    return false;
  }
  if ('ask_challenge' in value && value.ask_challenge !== undefined && !isAskChallenge(value.ask_challenge)) {
    return false;
  }
  return true;
}

export function isReviewDecision(value: unknown): value is ReviewDecision {
  if (!isObject(value)) return false;
  return (
    typeof value.decision === 'string' &&
    REVIEW_DECISIONS.has(value.decision as ReviewDecisionKind) &&
    typeof value.reason === 'string' &&
    typeof value.risk_level === 'string' &&
    RISK_LEVELS.has(value.risk_level as RiskLevel) &&
    'trace' in value
  );
}

export function isAskChallenge(value: unknown): value is AskChallenge {
  if (!isObject(value)) return false;
  return (
    typeof value.request_id === 'string' &&
    typeof value.prompt_text === 'string' &&
    isReviewDecision(value.review_snapshot) &&
    isObject(value.decision_context) &&
    Array.isArray(value.allowed_user_actions) &&
    value.allowed_user_actions.every(
      (entry) => typeof entry === 'string' && USER_ACTIONS.has(entry as UserAction),
    ) &&
    typeof value.timeout_behavior === 'string' &&
    ASK_TIMEOUT_BEHAVIORS.has(value.timeout_behavior as AskTimeoutBehavior) &&
    isReviewDecision(value.decision_context.current_review_snapshot) &&
    Array.isArray(value.decision_context.matched_risk_labels) &&
    value.decision_context.matched_risk_labels.every(
      (entry: unknown) => typeof entry === 'string' && RISK_LABELS.has(entry as RiskLabel),
    ) &&
    Array.isArray(value.decision_context.overridable_permissions) &&
    value.decision_context.overridable_permissions.every(
      (entry: unknown) => typeof entry === 'string' && PERMISSION_KINDS.has(entry as PermissionKind),
    ) &&
    typeof value.decision_context.hard_boundary_summary === 'string'
  );
}
