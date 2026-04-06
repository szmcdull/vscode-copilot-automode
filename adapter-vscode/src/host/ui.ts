import type { UserAction } from '../protocol/types.js';

export interface UiController {
  setReady(startedLocalProcess: boolean): Promise<void> | void;
  /** When status is \"ready\" (not error/safe mode), refresh from `autoMode.enabled`. */
  refreshReadyAppearance?(): Promise<void> | void;
  showServiceStartFailed(error: unknown): Promise<void> | void;
  showSafeModeState(active: boolean, reason: string): Promise<void> | void;
  showAskResolved(action: UserAction): Promise<void> | void;
  showRuntimeConstraintDeny(reason: string): Promise<void> | void;
  /** Extension-owned confirmation when the review engine returns `ask` (not host `ask`). */
  promptPreToolUseDecision(options: { title: string; prompt: string }): Promise<'allow' | 'deny'>;
  dispose?(): void;
}

export interface CreateUiControllerOptions {
  showInformationMessage: (message: string) => Promise<void> | void;
  showWarningMessage: (message: string) => Promise<void> | void;
  showErrorMessage: (message: string) => Promise<void> | void;
  appendLine: (message: string) => void;
  setStatus: (text: string) => void;
  /** When set, `setReady` / safe-mode exit show Ready vs Off from settings. */
  getHookReviewEnabled?: () => boolean;
  promptPreToolUseDecision?: (options: { title: string; prompt: string }) => Promise<'allow' | 'deny'>;
}

function readyStatusLine(enabled: boolean): string {
  return enabled ? 'Auto Mode: Ready' : 'Auto Mode: Off';
}

export function createUiController(options: CreateUiControllerOptions): UiController {
  return {
    async setReady(startedLocalProcess) {
      const enabled = options.getHookReviewEnabled?.() ?? true;
      options.setStatus(readyStatusLine(enabled));
      options.appendLine(
        startedLocalProcess ? '[runtime_ready] local runtime initialized' : '[runtime_ready] local model review ready',
      );
    },

    async refreshReadyAppearance() {
      const enabled = options.getHookReviewEnabled?.() ?? true;
      options.setStatus(readyStatusLine(enabled));
    },

    async showServiceStartFailed(error) {
      const message = error instanceof Error ? error.message : 'unknown startup error';
      options.setStatus('Auto Mode: Error');
      options.appendLine(`[runtime_error] ${message}`);
      await options.showErrorMessage(`Auto Mode failed to start: ${message}`);
    },

    async showSafeModeState(active, reason) {
      if (active) {
        options.setStatus('Auto Mode: Safe Mode');
        options.appendLine(`[safe_mode] ${reason}`);
        await options.showWarningMessage(`Auto Mode entered safe mode: ${reason}`);
        return;
      }

      options.setStatus(readyStatusLine(options.getHookReviewEnabled?.() ?? true));
      options.appendLine('[safe_mode] recovered');
      await options.showInformationMessage('Auto Mode exited safe mode');
    },

    async showAskResolved(action) {
      options.appendLine(`[ask_resolved] ${action}`);
      await options.showInformationMessage(`Auto Mode ask decision: ${action}`);
    },

    async showRuntimeConstraintDeny(reason) {
      options.appendLine(`[runtime_constraint_deny] ${reason}`);
      await options.showWarningMessage(`Auto Mode runtime constraint denied execution: ${reason}`);
    },

    async promptPreToolUseDecision(opts) {
      if (options.promptPreToolUseDecision) {
        return options.promptPreToolUseDecision(opts);
      }

      options.appendLine(`[pre_tool_use_ask] ${opts.prompt}`);
      await options.showWarningMessage(opts.title);
      return 'deny';
    },
  };
}
