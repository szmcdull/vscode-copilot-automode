import path from 'node:path';
import type {
  NormalizedEffects,
  OperationCategory,
  OperationRequest,
  PermissionKind,
  SourceKind,
} from '../protocol/types.js';

type FileLikeCategory = 'file_write' | 'file_edit';

export interface AdapterOperationBase {
  id: string;
  source: SourceKind;
  session: string;
  workspace: string;
  tool: string;
  category: OperationCategory;
  intent?: string;
  arguments?: unknown;
  modelContext?: unknown;
  timestamp: string;
}

export interface ShellOperationInput extends AdapterOperationBase {
  category: 'shell';
  cwd?: string;
  readPaths?: string[];
  writePaths?: string[];
  deletePaths?: string[];
  mayUseNetwork?: boolean;
  mayMutateGitHistory?: boolean;
  touchesCredentials?: boolean;
}

export interface FileOperationInput extends AdapterOperationBase {
  category: FileLikeCategory;
  targetPath: string;
  touchesCredentials?: boolean;
}

export interface MCPOperationInput extends AdapterOperationBase {
  category: 'mcp';
  knownMcpTool?: boolean;
  writePaths?: string[];
  mayUseNetwork?: boolean;
}

export type AdapterOperationInput =
  | ShellOperationInput
  | FileOperationInput
  | MCPOperationInput;

export interface AdapterRiskSignals {
  unknown_mcp_tool?: boolean;
  touches_sensitive_file?: boolean;
}

export interface NormalizationResult {
  normalizedEffects: NormalizedEffects;
  requestedPermissions: PermissionKind[];
  riskSignals: AdapterRiskSignals;
}

const SENSITIVE_PATH_FRAGMENTS = ['.ssh/', '/.ssh', '.env', 'credentials', 'id_rsa', 'id_ed25519', '.aws/', '.gnupg/'];

export function inferNormalization(input: AdapterOperationInput): NormalizationResult {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspace);
  const normalizedEffects: NormalizedEffects = {};
  const requestedPermissions: PermissionKind[] = [];
  const riskSignals: AdapterRiskSignals = {};

  const addPermission = (permission: PermissionKind) => {
    if (!requestedPermissions.includes(permission)) {
      requestedPermissions.push(permission);
    }
  };

  if (input.category === 'shell') {
    normalizedEffects.may_spawn_process = true;
    addPermission('shell_execute');

    const shellBase = normalizeAbsolute(input.cwd ?? input.workspace, workspaceRoot);
    const readPatterns = normalizePathList(input.readPaths, shellBase);
    const writePatterns = normalizePathList(input.writePaths, shellBase);
    const deletePatterns = normalizePathList(input.deletePaths, shellBase);

    if (readPatterns.length > 0) {
      normalizedEffects.path_read_patterns = readPatterns;
    }
    if (writePatterns.length > 0) {
      normalizedEffects.path_write_patterns = writePatterns;
      addPermission('filesystem_write');
    }
    if (deletePatterns.length > 0) {
      normalizedEffects.may_delete_files = true;
      addPermission('filesystem_delete');
    }
    if (input.mayUseNetwork) {
      normalizedEffects.may_use_network = true;
      addPermission('network_egress');
    }
    if (input.mayMutateGitHistory) {
      normalizedEffects.may_mutate_git_history = true;
      addPermission('git_mutation');
    }
    if (input.touchesCredentials) {
      normalizedEffects.touches_credentials = true;
      addPermission('credential_access');
    }

    const escapesWorkspace =
      !isWithinWorkspace(shellBase, workspaceRoot) ||
      [...readPatterns, ...writePatterns, ...deletePatterns].some((entry) => !isWithinWorkspace(entry, workspaceRoot));
    normalizedEffects.escapes_workspace = escapesWorkspace;
    if (escapesWorkspace) {
      addPermission('workspace_escape');
    }

    if (writePatterns.some(isSensitivePath)) {
      riskSignals.touches_sensitive_file = true;
    }
  } else if (input.category === 'file_write' || input.category === 'file_edit') {
    const targetPath = normalizeAbsolute(input.targetPath, workspaceRoot);
    normalizedEffects.path_write_patterns = [targetPath];
    normalizedEffects.escapes_workspace = !isWithinWorkspace(targetPath, workspaceRoot);
    addPermission('filesystem_write');
    if (normalizedEffects.escapes_workspace) {
      addPermission('workspace_escape');
    }
    if (input.touchesCredentials) {
      normalizedEffects.touches_credentials = true;
      addPermission('credential_access');
    }
    if (isSensitivePath(targetPath)) {
      riskSignals.touches_sensitive_file = true;
    }
  } else if (input.category === 'mcp') {
    addPermission('mcp_external');
    const writePatterns = normalizePathList(input.writePaths, workspaceRoot);
    if (writePatterns.length > 0) {
      normalizedEffects.path_write_patterns = writePatterns;
      addPermission('filesystem_write');
    }
    if (input.mayUseNetwork) {
      normalizedEffects.may_use_network = true;
      addPermission('network_egress');
    }
    const escapesWorkspace = writePatterns.some((entry) => !isWithinWorkspace(entry, workspaceRoot));
    if (escapesWorkspace) {
      normalizedEffects.escapes_workspace = true;
      addPermission('workspace_escape');
    }
    if (writePatterns.some(isSensitivePath)) {
      riskSignals.touches_sensitive_file = true;
    }
    if (input.knownMcpTool === false || isUnknownToolName(input.tool)) {
      riskSignals.unknown_mcp_tool = true;
    }
  }

  return {
    normalizedEffects: compactObject(normalizedEffects),
    requestedPermissions,
    riskSignals,
  };
}

function normalizePathList(paths: string[] | undefined, baseDir: string): string[] {
  return (paths ?? []).map((entry) => normalizeAbsolute(entry, baseDir));
}

function normalizeAbsolute(rawPath: string, baseDir: string): string {
  const absolute = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(baseDir, rawPath);
  return toPosixPath(absolute);
}

function normalizeWorkspaceRoot(workspace: string): string {
  const absolute = path.isAbsolute(workspace) ? path.normalize(workspace) : path.resolve(workspace);
  return toPosixPath(absolute);
}

function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  if (candidate === workspaceRoot) {
    return true;
  }
  return candidate.startsWith(`${workspaceRoot}/`);
}

function isUnknownToolName(tool: string): boolean {
  const normalized = tool.trim().toLowerCase();
  return normalized === '' || normalized === 'unknown';
}

function isSensitivePath(targetPath: string): boolean {
  const normalized = toPosixPath(targetPath).toLowerCase();
  return SENSITIVE_PATH_FRAGMENTS.some((fragment) => normalized.includes(fragment.toLowerCase()));
}

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function compactObject<T extends object>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

export type { OperationRequest };
