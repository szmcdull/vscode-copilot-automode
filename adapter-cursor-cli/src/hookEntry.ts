import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CursorHookEventName,
  cursorPayloadToPreToolUse,
} from './cursorPayload.js';
import {
  buildDryRunCursorPermission,
  preToolUseResultToCursorPermission,
  type CursorPermissionHookOutput,
} from './cursorResult.js';
import { readModelConfigFromEnv } from './modelConfigFromEnv.js';
import { createShellReviewEngineFromModelConfig, runShellReview } from './shellReview.js';
import { parseHookArgv, readHookStdinPayload } from './stdin.js';
import { RUN_IN_TERMINAL_TOOL_NAME } from '../../shared/src/toolNames.js';

function buildSkipOutput(): CursorPermissionHookOutput {
  return {
    permission: 'allow',
    agentMessage: 'Auto Mode CLI adapter skipped by AUTO_MODE_SKIP_CURSOR_HOOK=1.',
  };
}

function hasReviewConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.AUTO_MODE_API_KEY?.trim() && env.AUTO_MODE_MODEL_NAME?.trim());
}

function resolveMode(env: NodeJS.ProcessEnv): 'dry-run' | 'review' {
  if (env.AUTO_MODE_CURSOR_CLI_MODE === 'dry-run') return 'dry-run';
  if (env.AUTO_MODE_CURSOR_CLI_MODE === 'review') return 'review';
  return hasReviewConfig(env) ? 'review' : 'dry-run';
}

export async function runCursorCliHook(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.AUTO_MODE_SKIP_CURSOR_HOOK === '1') {
    return `${JSON.stringify(buildSkipOutput())}\n`;
  }

  const { event, skipStdinRead } = parseHookArgv(argv.slice(2));
  if (event !== 'beforeShellExecution' && event !== 'preToolUse') {
    throw new Error(
      `usage: hookEntry.js <beforeShellExecution|preToolUse> [--no-stdin] (stdin JSON). Got: ${argv[2] ?? '(missing)'}`,
    );
  }

  const raw = skipStdinRead ? '' : await readHookStdinPayload(process.stdin, env);
  let payload: unknown = {};
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = {};
    }
  }

  const preToolPayload = cursorPayloadToPreToolUse(event, payload);
  if (preToolPayload.tool_name !== RUN_IN_TERMINAL_TOOL_NAME) {
    return `${JSON.stringify({ permission: 'allow' satisfies CursorPermissionHookOutput['permission'] })}\n`;
  }

  const mode = resolveMode(env);
  if (mode === 'dry-run') {
    const decision = env.AUTO_MODE_CURSOR_CLI_DRY_RUN_DECISION === 'deny' ? 'deny' : 'allow';
    const command = typeof preToolPayload.tool_input.command === 'string' ? preToolPayload.tool_input.command : '';
    return `${JSON.stringify(
      buildDryRunCursorPermission({
        event,
        cwd: preToolPayload.cwd,
        command,
        decision,
      }),
    )}\n`;
  }

  let modelConfig;
  try {
    modelConfig = readModelConfigFromEnv(env);
  } catch (err: unknown) {
    if (env.AUTO_MODE_CURSOR_CLI_MODE === 'review') {
      const message = err instanceof Error ? err.message : String(err);
      return `${JSON.stringify({
        permission: 'deny',
        agentMessage: `Auto Mode CLI review misconfigured: ${message}`,
      } satisfies CursorPermissionHookOutput)}\n`;
    }
    const command = typeof preToolPayload.tool_input.command === 'string' ? preToolPayload.tool_input.command : '';
    return `${JSON.stringify(
      buildDryRunCursorPermission({
        event,
        cwd: preToolPayload.cwd,
        command,
        decision: 'allow',
      }),
    )}\n`;
  }
  const reviewEngine = createShellReviewEngineFromModelConfig(modelConfig);
  const reviewResult = await runShellReview(preToolPayload, {
    workspaceRoot: preToolPayload.cwd,
    reviewEngine,
  });
  return `${JSON.stringify(preToolUseResultToCursorPermission(reviewResult))}\n`;
}

async function main(): Promise<void> {
  const output = await runCursorCliHook(process.argv);
  process.stdout.write(output);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`adapter-cursor-cli: ${message}\n`);
    process.exitCode = 2;
  });
}
