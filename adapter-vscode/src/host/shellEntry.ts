import type { AskChallenge, UserAction } from '../protocol/types.js';
import type { createAdapterBundle } from '../extension.js';
import type { UiController } from './ui.js';

export interface ShellCommandEntry {
  run(): Promise<{ status: 'cancelled' | 'executed' | 'denied' }>;
}

export interface CreateShellCommandEntryOptions {
  adapterBundle: Pick<ReturnType<typeof createAdapterBundle>, 'handleShellInterception' | 'safeModeController'>;
  promptForCommand: () => Promise<string | undefined>;
  promptUserAction: (challenge: AskChallenge) => Promise<UserAction>;
  executeShell: (command: string) => Promise<void>;
  showInformationMessage: (message: string) => Promise<void> | void;
  showWarningMessage: (message: string) => Promise<void> | void;
  showErrorMessage: (message: string) => Promise<void> | void;
  ui?: Pick<UiController, 'showSafeModeState' | 'showAskResolved' | 'showRuntimeConstraintDeny'>;
  getWorkspaceRoot: () => string;
  getSessionId: () => string;
  getRequestId: () => string;
  now: () => string;
}

export function createShellCommandEntry(options: CreateShellCommandEntryOptions): ShellCommandEntry {
  return {
    async run() {
      const command = (await options.promptForCommand())?.trim();
      if (!command) {
        return { status: 'cancelled' };
      }
      let chosenAction: UserAction | undefined;

      try {
        const result = await options.adapterBundle.handleShellInterception(
          {
            id: options.getRequestId(),
            session: options.getSessionId(),
            workspace: options.getWorkspaceRoot(),
            cwd: options.getWorkspaceRoot(),
            command: [command],
            timestamp: options.now(),
            intent: 'Reviewed shell command from extension command',
          },
          {
            promptUser: async (challenge) => {
              chosenAction = await options.promptUserAction(challenge);
              return chosenAction;
            },
          },
        );

        if (options.adapterBundle.safeModeController.isInSafeMode()) {
          await options.ui?.showSafeModeState(
            true,
            'local review fallback requires explicit confirmation',
          );
        }

        if (chosenAction) {
          await options.ui?.showAskResolved(chosenAction);
        }

        if (result.execution.action === 'execute') {
          await options.executeShell(command);
          if (!chosenAction) {
            await options.showInformationMessage(`Shell command approved: ${command}`);
          }
          return { status: 'executed' };
        }

        if (result.finalDecisionSource === 'runtime_constraint') {
          await options.ui?.showRuntimeConstraintDeny(result.finalDecision.reason);
          return { status: 'denied' };
        }

        await options.showWarningMessage(`Shell command denied: ${result.finalDecision.reason}`);
        return { status: 'denied' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown shell entry error';
        await options.showErrorMessage(`Shell command review failed: ${message}`);
        throw error;
      }
    },
  };
}
