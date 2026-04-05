import { describe, expect, it, vi } from 'vitest';
import { createShellCommandEntry } from './shellEntry.js';

describe('shell command entry', () => {
  it('prompts for a shell command, routes it through review, and executes on allow', async () => {
    const handleShellInterception = vi.fn().mockResolvedValue({
      request: { id: 'shell-1' },
      finalDecision: { decision: 'allow', reason: 'ok', risk_level: 'medium', trace: { steps: ['allow'] } },
      finalDecisionSource: 'review_service',
      execution: {
        action: 'execute',
        requestId: 'shell-1',
        trace: { steps: ['allow'] },
      },
    });
    const executeShell = vi.fn().mockResolvedValue(undefined);
    const showInformationMessage = vi.fn().mockResolvedValue(undefined);

    const entry = createShellCommandEntry({
      adapterBundle: {
        handleShellInterception,
        safeModeController: {
          isInSafeMode: vi.fn().mockReturnValue(false),
        },
      } as never,
      promptForCommand: vi.fn().mockResolvedValue('npm test'),
      promptUserAction: vi.fn(),
      executeShell,
      showInformationMessage,
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      ui: undefined,
      getWorkspaceRoot: () => '/workspace',
      getSessionId: () => 'session-1',
      getRequestId: () => 'shell-1',
      now: () => '2026-04-03T20:00:00.000Z',
    });

    const result = await entry.run();
    expect(handleShellInterception).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'shell-1',
        session: 'session-1',
        workspace: '/workspace',
        cwd: '/workspace',
        command: ['npm test'],
      }),
      expect.objectContaining({
        promptUser: expect.any(Function),
      }),
    );
    expect(executeShell).toHaveBeenCalledWith('npm test');
    expect(showInformationMessage).toHaveBeenCalledWith('Shell command approved: npm test');
    expect(result.status).toBe('executed');
  });

  it('shows a deny message and does not execute when review denies the command', async () => {
    const executeShell = vi.fn();
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const entry = createShellCommandEntry({
      adapterBundle: {
        safeModeController: {
          isInSafeMode: vi.fn().mockReturnValue(false),
        },
        handleShellInterception: vi.fn().mockResolvedValue({
          request: { id: 'shell-2' },
          finalDecision: {
            decision: 'deny',
            reason: 'too risky',
            risk_level: 'high',
            trace: { steps: ['deny'] },
          },
          finalDecisionSource: 'review_service',
          execution: {
            action: 'deny',
            requestId: 'shell-2',
            trace: { steps: ['deny'] },
          },
        }),
      } as never,
      promptForCommand: vi.fn().mockResolvedValue('rm -rf .'),
      promptUserAction: vi.fn(),
      executeShell,
      showInformationMessage: vi.fn(),
      showWarningMessage,
      showErrorMessage: vi.fn(),
      ui: undefined,
      getWorkspaceRoot: () => '/workspace',
      getSessionId: () => 'session-1',
      getRequestId: () => 'shell-2',
      now: () => '2026-04-03T20:00:00.000Z',
    });

    const result = await entry.run();
    expect(executeShell).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalledWith('Shell command denied: too risky');
    expect(result.status).toBe('denied');
  });

  it('uses host ask UI when the review loop requests user input', async () => {
    const promptUserAction = vi.fn().mockResolvedValue('approve');
    const showAskResolved = vi.fn().mockResolvedValue(undefined);
    const entry = createShellCommandEntry({
      adapterBundle: {
        safeModeController: {
          isInSafeMode: vi.fn().mockReturnValue(false),
        },
        handleShellInterception: vi.fn(async (_event, options) => {
          const action = await options?.promptUser?.({
            request_id: 'shell-3',
            prompt_text: 'Approve?',
            review_snapshot: {
              decision: 'ask',
              reason: 'needs input',
              risk_level: 'high',
              trace: { steps: ['ask'] },
            },
            decision_context: {
              current_review_snapshot: {
                decision: 'ask',
                reason: 'needs input',
                risk_level: 'high',
                trace: { steps: ['ask'] },
              },
              matched_risk_labels: [],
              overridable_permissions: ['shell_execute'],
              hard_boundary_summary: 'Need approval.',
            },
            allowed_user_actions: ['approve', 'deny', 'cancel'],
            timeout_behavior: 'deny',
          });
          return {
            request: { id: 'shell-3' },
            finalDecision: {
              decision: action === 'approve' ? 'allow' : 'deny',
              reason: 'resolved',
              risk_level: 'high',
              trace: { steps: ['ask_resolved'] },
            },
            finalDecisionSource: 'review_service_user_decision',
            execution: {
              action: action === 'approve' ? 'execute' : 'deny',
              requestId: 'shell-3',
              trace: { steps: ['ask_resolved'] },
            },
          };
        }),
      } as never,
      promptForCommand: vi.fn().mockResolvedValue('npm test'),
      promptUserAction,
      executeShell: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn(),
      ui: {
        showSafeModeState: vi.fn(),
        showAskResolved,
        showRuntimeConstraintDeny: vi.fn(),
      },
      getWorkspaceRoot: () => '/workspace',
      getSessionId: () => 'session-1',
      getRequestId: () => 'shell-3',
      now: () => '2026-04-03T20:00:00.000Z',
    });

    const result = await entry.run();
    expect(promptUserAction).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'shell-3',
        prompt_text: 'Approve?',
      }),
    );
    expect(showAskResolved).toHaveBeenCalledWith('approve');
    expect(result.status).toBe('executed');
  });

  it('shows runtime constraint deny and safe mode warning when applicable', async () => {
    const showSafeModeState = vi.fn().mockResolvedValue(undefined);
    const showRuntimeConstraintDeny = vi.fn().mockResolvedValue(undefined);
    const entry = createShellCommandEntry({
      adapterBundle: {
        safeModeController: {
          isInSafeMode: vi.fn().mockReturnValue(true),
        },
        handleShellInterception: vi.fn().mockResolvedValue({
          request: { id: 'shell-4' },
          finalDecision: {
            decision: 'deny',
            reason: 'command blocked by allowlist',
            risk_level: 'high',
            trace: { steps: ['runtime_constraint_violation'] },
          },
          finalDecisionSource: 'runtime_constraint',
          execution: {
            action: 'deny',
            requestId: 'shell-4',
            trace: { steps: ['runtime_constraint_violation'] },
          },
        }),
      } as never,
      promptForCommand: vi.fn().mockResolvedValue('rm -rf .'),
      promptUserAction: vi.fn(),
      executeShell: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      ui: {
        showSafeModeState,
        showAskResolved: vi.fn(),
        showRuntimeConstraintDeny,
      },
      getWorkspaceRoot: () => '/workspace',
      getSessionId: () => 'session-1',
      getRequestId: () => 'shell-4',
      now: () => '2026-04-03T20:00:00.000Z',
    });

    const result = await entry.run();
    expect(showSafeModeState).toHaveBeenCalledWith(
      true,
      'local review fallback requires explicit confirmation',
    );
    expect(showRuntimeConstraintDeny).toHaveBeenCalledWith('command blocked by allowlist');
    expect(result.status).toBe('denied');
  });
});
