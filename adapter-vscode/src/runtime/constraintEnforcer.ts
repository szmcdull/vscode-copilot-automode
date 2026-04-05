import path from 'node:path';
import type { ConstraintSet, RiskLevel, ReviewDecision } from '../protocol/types.js';

export type RuntimeOperationKind = 'file_write' | 'file_delete' | 'network' | 'shell' | 'git';

export type ViolationCode =
  | 'workspace_only'
  | 'path_allowlist'
  | 'path_denylist'
  | 'forbid_delete'
  | 'host_allowlist'
  | 'command_template_allowlist'
  | 'git_read_only';

export interface GuardViolation {
  code: ViolationCode;
  detail: string;
  constraint?: string;
}

export interface RuntimeConstraintInput {
  workspaceRoot: string;
  kind: RuntimeOperationKind;
  paths?: string[];
  host?: string;
  shellCommand?: string[];
  gitMutating?: boolean;
}

export interface CompiledConstraintSet {
  workspaceOnly: boolean;
  forbidDelete: boolean;
  gitReadOnly: boolean;
  pathAllowPrefixes: string[];
  pathDenyPrefixes: string[];
  hostAllow: string[];
  commandPatterns: string[];
}

export interface EnforceConstraintsOptions {
  compiled: CompiledConstraintSet;
  requestId: string;
  riskLevel: RiskLevel;
  input: RuntimeConstraintInput;
}

export interface ConstraintEnforcementResult {
  outcome: 'allow' | 'deny';
  violations: GuardViolation[];
  finalDecision?: ReviewDecision;
}

export function compileConstraintSet(constraints?: ConstraintSet): CompiledConstraintSet {
  return {
    workspaceOnly: constraints?.workspace_only ?? false,
    forbidDelete: constraints?.forbid_delete ?? false,
    gitReadOnly: constraints?.git_read_only ?? false,
    pathAllowPrefixes: [...(constraints?.path_allowlist ?? []), ...(constraints?.allowed_modify_paths ?? [])],
    pathDenyPrefixes: constraints?.path_denylist ?? [],
    hostAllow: constraints?.host_allowlist ?? [],
    commandPatterns: constraints?.command_template_allowlist ?? [],
  };
}

export function enforceConstraints(options: EnforceConstraintsOptions): ConstraintEnforcementResult {
  const violations = evaluateViolations(options.compiled, options.input);
  if (violations.length === 0) {
    return { outcome: 'allow', violations: [] };
  }

  return {
    outcome: 'deny',
    violations,
    finalDecision: {
      decision: 'deny',
      reason: 'runtime constraint violation',
      risk_level: options.riskLevel,
      trace: {
        steps: ['runtime_constraint_violation', violations[0].code],
        request_id: options.requestId,
      },
    },
  };
}

function evaluateViolations(
  compiled: CompiledConstraintSet,
  input: RuntimeConstraintInput,
): GuardViolation[] {
  switch (input.kind) {
    case 'file_write':
    case 'file_delete':
      return evaluateFile(compiled, input);
    case 'network':
      return evaluateNetwork(compiled, input);
    case 'shell':
      return evaluateShell(compiled, input);
    case 'git':
      return evaluateGit(compiled, input);
    default:
      return [];
  }
}

function evaluateFile(
  compiled: CompiledConstraintSet,
  input: RuntimeConstraintInput,
): GuardViolation[] {
  const workspace = clean(input.workspaceRoot);
  const violations: GuardViolation[] = [];

  for (const entry of input.paths ?? []) {
    const candidate = clean(entry);
    if (compiled.workspaceOnly && !isWithinWorkspace(candidate, workspace)) {
      violations.push({
        code: 'workspace_only',
        detail: `path "${candidate}" is outside workspace "${workspace}"`,
        constraint: 'workspace_only',
      });
      continue;
    }

    for (const prefix of compiled.pathDenyPrefixes) {
      if (matchesPrefix(candidate, workspace, prefix)) {
        violations.push({
          code: 'path_denylist',
          detail: `path "${candidate}" matches deny prefix "${prefix}"`,
          constraint: 'path_denylist',
        });
      }
    }

    if (compiled.pathAllowPrefixes.length > 0 && !compiled.pathAllowPrefixes.some((prefix) => matchesPrefix(candidate, workspace, prefix))) {
      violations.push({
        code: 'path_allowlist',
        detail: `path "${candidate}" does not match path_allowlist / allowed_modify_paths`,
        constraint: 'path_allowlist',
      });
    }
  }

  if (input.kind === 'file_delete' && compiled.forbidDelete) {
    violations.push({
      code: 'forbid_delete',
      detail: 'delete operation denied by forbid_delete',
      constraint: 'forbid_delete',
    });
  }

  return violations;
}

function evaluateNetwork(
  compiled: CompiledConstraintSet,
  input: RuntimeConstraintInput,
): GuardViolation[] {
  if (compiled.hostAllow.length === 0) {
    return [];
  }
  const host = stripHostPort(input.host ?? '');
  if (host === '') {
    return [{
      code: 'host_allowlist',
      detail: 'empty host for network operation',
      constraint: 'host_allowlist',
    }];
  }
  if (compiled.hostAllow.includes(host)) {
    return [];
  }
  return [{
    code: 'host_allowlist',
    detail: `host "${host}" not in host_allowlist`,
    constraint: 'host_allowlist',
  }];
}

function evaluateShell(
  compiled: CompiledConstraintSet,
  input: RuntimeConstraintInput,
): GuardViolation[] {
  if (compiled.commandPatterns.length === 0) {
    return [];
  }
  const line = (input.shellCommand ?? []).join(' ').trim();
  if (line === '') {
    return [{
      code: 'command_template_allowlist',
      detail: 'empty shell command under command_template_allowlist',
      constraint: 'command_template_allowlist',
    }];
  }
  if (compiled.commandPatterns.some((pattern) => matchesGlob(pattern, line))) {
    return [];
  }
  return [{
    code: 'command_template_allowlist',
    detail: `command "${line}" matches no template in command_template_allowlist`,
    constraint: 'command_template_allowlist',
  }];
}

function evaluateGit(
  compiled: CompiledConstraintSet,
  input: RuntimeConstraintInput,
): GuardViolation[] {
  if (compiled.gitReadOnly && input.gitMutating) {
    return [{
      code: 'git_read_only',
      detail: 'git mutation denied while git_read_only is set',
      constraint: 'git_read_only',
    }];
  }
  return [];
}

function matchesPrefix(candidate: string, workspaceRoot: string, rule: string): boolean {
  const base = clean(path.join(workspaceRoot, rule));
  return candidate === base || candidate.startsWith(`${base}/`);
}

function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  return candidate === workspaceRoot || candidate.startsWith(`${workspaceRoot}/`);
}

function stripHostPort(value: string): string {
  const trimmed = value.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0 || trimmed.includes(']')) {
    return trimmed;
  }
  return trimmed.slice(0, idx);
}

function matchesGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replaceAll('*', '.*').replaceAll('?', '.')}$`);
  return regex.test(value);
}

function clean(value: string): string {
  const normalized = path.normalize(value).replaceAll('\\', '/');
  const trimmed = normalized.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}
