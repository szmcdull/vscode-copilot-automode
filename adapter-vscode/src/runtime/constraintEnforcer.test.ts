import { describe, expect, it } from 'vitest';
import { enforceConstraints, type CompiledConstraintSet } from './constraintEnforcer.js';

describe('constraintEnforcer', () => {
  it('allows and denies file writes according to path allowlist', () => {
    const compiled: CompiledConstraintSet = {
      workspaceOnly: true,
      forbidDelete: false,
      gitReadOnly: false,
      pathAllowPrefixes: ['src/'],
      pathDenyPrefixes: [],
      hostAllow: [],
      commandPatterns: [],
    };

    const allowed = enforceConstraints({
      compiled,
      requestId: 'allow-src',
      riskLevel: 'medium',
      input: {
        workspaceRoot: '/workspace',
        kind: 'file_write',
        paths: ['/workspace/src/main.ts'],
      },
    });
    const denied = enforceConstraints({
      compiled,
      requestId: 'deny-outside-allow',
      riskLevel: 'high',
      input: {
        workspaceRoot: '/workspace',
        kind: 'file_write',
        paths: ['/workspace/README.md'],
      },
    });

    expect(allowed.outcome).toBe('allow');
    expect(denied.outcome).toBe('deny');
    expect(denied.violations).toEqual([
      {
        code: 'path_allowlist',
        detail: 'path "/workspace/README.md" does not match path_allowlist / allowed_modify_paths',
        constraint: 'path_allowlist',
      },
    ]);
  });

  it('denies hosts outside host_allowlist', () => {
    const compiled: CompiledConstraintSet = {
      workspaceOnly: false,
      forbidDelete: false,
      gitReadOnly: false,
      pathAllowPrefixes: [],
      pathDenyPrefixes: [],
      hostAllow: ['api.example.com'],
      commandPatterns: [],
    };

    const allowed = enforceConstraints({
      compiled,
      requestId: 'host-ok',
      riskLevel: 'medium',
      input: {
        workspaceRoot: '/workspace',
        kind: 'network',
        host: 'api.example.com:443',
      },
    });
    const denied = enforceConstraints({
      compiled,
      requestId: 'host-bad',
      riskLevel: 'high',
      input: {
        workspaceRoot: '/workspace',
        kind: 'network',
        host: 'evil.example.net:443',
      },
    });

    expect(allowed.outcome).toBe('allow');
    expect(denied.outcome).toBe('deny');
    expect(denied.violations[0]?.code).toBe('host_allowlist');
  });

  it('denies shell commands outside command template allowlist', () => {
    const compiled: CompiledConstraintSet = {
      workspaceOnly: false,
      forbidDelete: false,
      gitReadOnly: false,
      pathAllowPrefixes: [],
      pathDenyPrefixes: [],
      hostAllow: [],
      commandPatterns: ['git status*'],
    };

    const allowed = enforceConstraints({
      compiled,
      requestId: 'cmd-ok',
      riskLevel: 'low',
      input: {
        workspaceRoot: '/workspace',
        kind: 'shell',
        shellCommand: ['git', 'status', '--short'],
      },
    });
    const denied = enforceConstraints({
      compiled,
      requestId: 'cmd-bad',
      riskLevel: 'high',
      input: {
        workspaceRoot: '/workspace',
        kind: 'shell',
        shellCommand: ['rm', '-rf', '.'],
      },
    });

    expect(allowed.outcome).toBe('allow');
    expect(denied.outcome).toBe('deny');
    expect(denied.violations[0]?.code).toBe('command_template_allowlist');
  });

  it('maps runtime workspace escape to a final deny decision with trace', () => {
    const compiled: CompiledConstraintSet = {
      workspaceOnly: true,
      forbidDelete: false,
      gitReadOnly: false,
      pathAllowPrefixes: [],
      pathDenyPrefixes: [],
      hostAllow: [],
      commandPatterns: [],
    };

    const result = enforceConstraints({
      compiled,
      requestId: 'escape-1',
      riskLevel: 'high',
      input: {
        workspaceRoot: '/workspace',
        kind: 'file_write',
        paths: ['/etc/passwd'],
      },
    });

    expect(result.outcome).toBe('deny');
    expect(result.finalDecision).toEqual({
      decision: 'deny',
      reason: 'runtime constraint violation',
      risk_level: 'high',
      trace: {
        steps: ['runtime_constraint_violation', 'workspace_only'],
        request_id: 'escape-1',
      },
    });
  });
});
