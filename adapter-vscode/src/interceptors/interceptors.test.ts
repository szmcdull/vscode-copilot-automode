import { describe, expect, it } from 'vitest';
import { createFileInterceptor } from './fileInterceptor.js';
import { createGitInterceptor } from './gitInterceptor.js';
import { createMcpInterceptor } from './mcpInterceptor.js';
import { createNetworkInterceptor } from './networkInterceptor.js';
import { createShellInterceptor } from './shellInterceptor.js';

describe('first interceptor set', () => {
  it('captures shell requests with normalized effects and routes them through review service', () => {
    const interceptor = createShellInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'shell-1',
      session: 'session-1',
      workspace: '/workspace',
      command: ['npm', 'test'],
      cwd: '/workspace',
      readPaths: ['package.json'],
      timestamp: '2026-04-03T18:00:00.000Z',
      intent: 'Run tests',
    });

    expect(result.request.category).toBe('shell');
    expect(result.request.arguments).toEqual({ command: 'npm test', argv: ['npm', 'test'] });
    expect(result.request.requested_permissions).toEqual(['shell_execute']);
    expect(result.request.normalized_effects).toEqual({
      may_spawn_process: true,
      path_read_patterns: ['/workspace/package.json'],
      escapes_workspace: false,
    });
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });

  it('captures file writes and routes them through review service', () => {
    const interceptor = createFileInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'file-1',
      session: 'session-1',
      workspace: '/workspace',
      path: 'src/main.ts',
      contentsPreview: 'export const value = 1;',
      timestamp: '2026-04-03T18:00:00.000Z',
    });

    expect(result.request.category).toBe('file_write');
    expect(result.request.tool).toBe('write_file');
    expect(result.request.arguments).toEqual({
      path: 'src/main.ts',
      content_preview: 'export const value = 1;',
    });
    expect(result.request.requested_permissions).toEqual(['filesystem_write']);
    expect(result.request.normalized_effects).toEqual({
      path_write_patterns: ['/workspace/src/main.ts'],
      escapes_workspace: false,
    });
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });

  it('captures file edits via the edit-specific request shape', () => {
    const interceptor = createFileInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'file-2',
      session: 'session-1',
      workspace: '/workspace',
      path: 'src/main.ts',
      contentsPreview: 'replace value',
      timestamp: '2026-04-03T18:00:00.000Z',
      mode: 'edit',
    });

    expect(result.request.category).toBe('file_edit');
    expect(result.request.tool).toBe('edit_file');
    expect(result.request.arguments).toEqual({
      path: 'src/main.ts',
      content_preview: 'replace value',
    });
    expect(result.request.requested_permissions).toEqual(['filesystem_write']);
    expect(result.request.normalized_effects).toEqual({
      path_write_patterns: ['/workspace/src/main.ts'],
      escapes_workspace: false,
    });
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
  });

  it('captures git mutation requests with git-specific normalized effects', () => {
    const interceptor = createGitInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'git-1',
      session: 'session-1',
      workspace: '/workspace',
      argv: ['git', 'rebase', '-i', 'HEAD~2'],
      timestamp: '2026-04-03T18:00:00.000Z',
      mutating: true,
      fullyObserved: true,
    });

    expect(result.request.category).toBe('git');
    expect(result.request.arguments).toEqual({
      argv: ['git', 'rebase', '-i', 'HEAD~2'],
      command: 'git rebase -i HEAD~2',
    });
    expect(result.request.requested_permissions).toEqual(['git_mutation']);
    expect(result.request.normalized_effects).toEqual({ may_mutate_git_history: true });
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });

  it('captures network requests with network-specific normalized effects', () => {
    const interceptor = createNetworkInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'net-1',
      session: 'session-1',
      workspace: '/workspace',
      url: 'https://api.example.com/v1/packages',
      method: 'GET',
      timestamp: '2026-04-03T18:00:00.000Z',
      fullyObserved: true,
    });

    expect(result.request.category).toBe('network');
    expect(result.request.arguments).toEqual({
      url: 'https://api.example.com/v1/packages',
      method: 'GET',
    });
    expect(result.request.requested_permissions).toEqual(['network_egress']);
    expect(result.request.normalized_effects).toEqual({ may_use_network: true });
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });

  it('degrades unknown MCP tools to ask while still capturing a request snapshot', () => {
    const interceptor = createMcpInterceptor({ source: 'cursor' });
    const result = interceptor.intercept({
      id: 'mcp-1',
      session: 'session-2',
      workspace: '/workspace',
      toolName: 'unknown',
      arguments: { action: 'do-something' },
      timestamp: '2026-04-03T18:00:00.000Z',
      knownTool: false,
      fullyObserved: true,
    });

    expect(result.request.category).toBe('mcp');
    expect(result.request.arguments).toEqual({ action: 'do-something' });
    expect(result.request.requested_permissions).toEqual(['mcp_external']);
    expect(result.request.normalized_effects).toEqual({});
    expect(result.request.risk_signals).toEqual({ unknown_mcp_tool: true });
    expect(result.decisionHandlingPath).toBe('degrade_to_ask');
    expect(result.degradeReason).toBe('unknown_mcp_tool');
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });

  it('degrades partially observed network operations to ask', () => {
    const interceptor = createNetworkInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'net-2',
      session: 'session-1',
      workspace: '/workspace',
      url: 'https://api.example.com/v1/packages',
      method: 'POST',
      timestamp: '2026-04-03T18:00:00.000Z',
      fullyObserved: false,
    });

    expect(result.request.category).toBe('network');
    expect(result.request.requested_permissions).toEqual(['network_egress']);
    expect(result.request.normalized_effects).toEqual({ may_use_network: true });
    expect(result.decisionHandlingPath).toBe('degrade_to_ask');
    expect(result.degradeReason).toBe('partially_observed_operation');
  });

  it('degrades partially observed git operations to ask', () => {
    const interceptor = createGitInterceptor({ source: 'vscode' });
    const result = interceptor.intercept({
      id: 'git-2',
      session: 'session-1',
      workspace: '/workspace',
      argv: ['git', 'push', '--force-with-lease'],
      timestamp: '2026-04-03T18:00:00.000Z',
      mutating: true,
      fullyObserved: false,
    });

    expect(result.request.category).toBe('git');
    expect(result.request.requested_permissions).toEqual(['git_mutation']);
    expect(result.request.normalized_effects).toEqual({ may_mutate_git_history: true });
    expect(result.decisionHandlingPath).toBe('degrade_to_ask');
    expect(result.degradeReason).toBe('partially_observed_operation');
  });

  it('degrades partially observed MCP operations to ask even for known tools', () => {
    const interceptor = createMcpInterceptor({ source: 'cursor' });
    const result = interceptor.intercept({
      id: 'mcp-2',
      session: 'session-2',
      workspace: '/workspace',
      toolName: 'known-tool',
      arguments: { action: 'write' },
      timestamp: '2026-04-03T18:00:00.000Z',
      knownTool: true,
      fullyObserved: false,
    });

    expect(result.request.category).toBe('mcp');
    expect(result.request.requested_permissions).toEqual(['mcp_external']);
    expect(result.request.risk_signals).toEqual({});
    expect(result.decisionHandlingPath).toBe('degrade_to_ask');
    expect(result.degradeReason).toBe('partially_observed_operation');
  });

  it('routes known fully observed MCP tools through review service', () => {
    const interceptor = createMcpInterceptor({ source: 'cursor' });
    const result = interceptor.intercept({
      id: 'mcp-3',
      session: 'session-2',
      workspace: '/workspace',
      toolName: 'known-tool',
      arguments: { action: 'write' },
      timestamp: '2026-04-03T18:00:00.000Z',
      knownTool: true,
      fullyObserved: true,
    });

    expect(result.request.category).toBe('mcp');
    expect(result.request.tool).toBe('known-tool');
    expect(result.request.requested_permissions).toEqual(['mcp_external']);
    expect(result.request.normalized_effects).toEqual({});
    expect(result.request.risk_signals).toEqual({});
    expect(result.decisionHandlingPath).toBe('invoke_review_service');
    expect(result.degradeReason).toBeUndefined();
    expect(result.routing).toEqual({ wouldUseAiReview: true, wouldStaticAutoApprove: false });
  });
});
