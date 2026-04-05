import { describe, expect, it } from 'vitest';
import { normalizeOperationRequest } from './operationRequest.js';
import { inferNormalization } from './normalizedEffects.js';

describe('normalizers', () => {
  it('normalizes a shell command that only touches the workspace', () => {
    const normalized = inferNormalization({
      id: 'shell-1',
      source: 'vscode',
      session: 'session-1',
      workspace: '/workspace',
      tool: 'run_terminal_cmd',
      category: 'shell',
      intent: 'List workspace files',
      arguments: { command: 'ls src' },
      timestamp: '2026-04-03T16:00:00.000Z',
      cwd: '/workspace',
      readPaths: ['src/index.ts'],
    });

    expect(normalized.normalizedEffects).toEqual({
      may_spawn_process: true,
      path_read_patterns: ['/workspace/src/index.ts'],
      escapes_workspace: false,
    });
    expect(normalized.requestedPermissions).toEqual(['shell_execute']);
    expect(normalized.riskSignals).toEqual({});
  });

  it('marks a shell command touching a path outside the workspace as workspace escape', () => {
    const normalized = inferNormalization({
      id: 'shell-escape-1',
      source: 'vscode',
      session: 'session-1',
      workspace: '/workspace',
      tool: 'run_terminal_cmd',
      category: 'shell',
      arguments: { command: 'cat /etc/passwd' },
      timestamp: '2026-04-03T16:00:00.000Z',
      cwd: '/workspace',
      readPaths: ['/etc/passwd'],
    });

    expect(normalized.normalizedEffects).toMatchObject({
      may_spawn_process: true,
      path_read_patterns: ['/etc/passwd'],
      escapes_workspace: true,
    });
    expect(normalized.requestedPermissions).toEqual(['shell_execute', 'workspace_escape']);
  });

  it('marks file writes to sensitive paths', () => {
    const normalized = inferNormalization({
      id: 'file-write-1',
      source: 'vscode',
      session: 'session-1',
      workspace: '/workspace',
      tool: 'write_file',
      category: 'file_write',
      arguments: { path: '.env', content: 'TOKEN=abc' },
      timestamp: '2026-04-03T16:00:00.000Z',
      targetPath: '.env',
    });

    expect(normalized.normalizedEffects).toEqual({
      path_write_patterns: ['/workspace/.env'],
      escapes_workspace: false,
    });
    expect(normalized.requestedPermissions).toEqual(['filesystem_write']);
    expect(normalized.riskSignals).toEqual({ touches_sensitive_file: true });
  });

  it('marks unknown MCP tools via risk signals', () => {
    const normalized = inferNormalization({
      id: 'mcp-1',
      source: 'cursor',
      session: 'session-2',
      workspace: '/workspace',
      tool: 'unknown',
      category: 'mcp',
      intent: 'Call unregistered MCP tool',
      arguments: { action: 'do-something' },
      timestamp: '2026-04-03T16:00:00.000Z',
      knownMcpTool: false,
    });

    expect(normalized.normalizedEffects).toEqual({});
    expect(normalized.requestedPermissions).toEqual(['mcp_external']);
    expect(normalized.riskSignals).toEqual({ unknown_mcp_tool: true });
  });

  it('produces a protocol OperationRequest instead of leaking raw host fields', () => {
    const request = normalizeOperationRequest({
      id: 'file-write-2',
      source: 'vscode',
      session: 'session-3',
      workspace: '/workspace',
      tool: 'write_file',
      category: 'file_write',
      intent: 'Update env file',
      arguments: { path: '.env', content: 'TOKEN=abc' },
      modelContext: { plan: 'update local env file' },
      timestamp: '2026-04-03T16:00:00.000Z',
      targetPath: '.env',
    });

    expect(request).toEqual({
      id: 'file-write-2',
      source: 'vscode',
      session: 'session-3',
      workspace: '/workspace',
      tool: 'write_file',
      category: 'file_write',
      intent: 'Update env file',
      arguments: { path: '.env', content: 'TOKEN=abc' },
      normalized_effects: {
        path_write_patterns: ['/workspace/.env'],
        escapes_workspace: false,
      },
      requested_permissions: ['filesystem_write'],
      model_context: { plan: 'update local env file' },
      risk_signals: { touches_sensitive_file: true },
      timestamp: '2026-04-03T16:00:00.000Z',
    });
    expect(Object.keys(request).sort()).toEqual([
      'arguments',
      'category',
      'id',
      'intent',
      'model_context',
      'normalized_effects',
      'requested_permissions',
      'risk_signals',
      'session',
      'source',
      'timestamp',
      'tool',
      'workspace',
    ]);
  });

  it('resolves a relative workspace root only once before normalizing child paths', () => {
    const request = normalizeOperationRequest({
      id: 'relative-workspace-1',
      source: 'vscode',
      session: 'session-4',
      workspace: 'project',
      tool: 'write_file',
      category: 'file_write',
      arguments: { path: 'src/main.ts', content: 'export {}' },
      timestamp: '2026-04-03T16:00:00.000Z',
      targetPath: 'src/main.ts',
    });

    expect(request.workspace).toBe('project');
    expect(request.normalized_effects).toEqual({
      path_write_patterns: [`${process.cwd().replaceAll('\\', '/')}/project/src/main.ts`],
      escapes_workspace: false,
    });
  });
});
