import { describe, expect, it, vi } from 'vitest';
import { createUiController } from './ui.js';

describe('ui controller', () => {
  it('shows startup failure and marks status as errored', async () => {
    const showErrorMessage = vi.fn().mockResolvedValue(undefined);
    const appendLine = vi.fn();
    const setStatus = vi.fn();
    const ui = createUiController({
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage,
      appendLine,
      setStatus,
    });

    await ui.showServiceStartFailed(new Error('connection refused'));
    expect(showErrorMessage).toHaveBeenCalledWith(
      'Auto Mode failed to start: connection refused',
    );
    expect(setStatus).toHaveBeenCalledWith('Auto Mode: Error');
    expect(appendLine).toHaveBeenCalledWith('[runtime_error] connection refused');
  });

  it('updates safe mode status and warns the user when safe mode is active', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const setStatus = vi.fn();
    const ui = createUiController({
      showInformationMessage: vi.fn(),
      showWarningMessage,
      showErrorMessage: vi.fn(),
      appendLine: vi.fn(),
      setStatus,
    });

    await ui.showSafeModeState(true, 'review service unreachable');
    expect(showWarningMessage).toHaveBeenCalledWith(
      'Auto Mode entered safe mode: review service unreachable',
    );
    expect(setStatus).toHaveBeenCalledWith('Auto Mode: Safe Mode');
  });

  it('defaults pre-tool ask prompts to deny when no custom prompt handler is wired', async () => {
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const appendLine = vi.fn();
    const ui = createUiController({
      showInformationMessage: vi.fn(),
      showWarningMessage,
      showErrorMessage: vi.fn(),
      appendLine,
      setStatus: vi.fn(),
    });

    await expect(
      ui.promptPreToolUseDecision({ title: 'Confirm', prompt: 'Run `rm -rf`?' }),
    ).resolves.toBe('deny');
    expect(appendLine).toHaveBeenCalledWith('[pre_tool_use_ask] Run `rm -rf`?');
    expect(showWarningMessage).toHaveBeenCalledWith('Confirm');
  });

  it('reports ask resolution and runtime constraint deny distinctly', async () => {
    const showInformationMessage = vi.fn().mockResolvedValue(undefined);
    const showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const appendLine = vi.fn();
    const ui = createUiController({
      showInformationMessage,
      showWarningMessage,
      showErrorMessage: vi.fn(),
      appendLine,
      setStatus: vi.fn(),
    });

    await ui.showAskResolved('approve');
    await ui.showRuntimeConstraintDeny('command not in allowlist');

    expect(showInformationMessage).toHaveBeenCalledWith('Auto Mode ask decision: approve');
    expect(showWarningMessage).toHaveBeenCalledWith(
      'Auto Mode runtime constraint denied execution: command not in allowlist',
    );
    expect(appendLine).toHaveBeenCalledWith('[ask_resolved] approve');
    expect(appendLine).toHaveBeenCalledWith(
      '[runtime_constraint_deny] command not in allowlist',
    );
  });
});
