import { homedir } from 'node:os';

import { createReviewEngine } from '../../shared/src/review/reviewEngine.js';
import { resolvePhase1Accesses } from '../../shared/src/review/resolvedAccessResolver.js';
import type {
  Phase1ReviewResult,
  Phase2ReviewResult,
} from '../../shared/src/review/reviewPrompt.js';
import type {
  ResolvePhase1AccessesInput,
  ResolvePhase1AccessesResult,
} from '../../shared/src/review/resolvedAccessResolver.js';
import { createModelClient } from '../../shared/src/model/clientFactory.js';
import type { ModelConfig } from '../../shared/src/model/types.js';
import type { PreToolUsePayload } from '../../shared/src/hookPayloads.js';
import type { PreToolUseHookResult } from '../../shared/src/preToolUseHookResult.js';

export interface ShellReviewEngine {
  reviewPhase1ShellCommand(input: {
    userPrompt: string;
    command: string;
    workspaceRoot: string;
    homeDir: string;
    cwd: string;
  }): Promise<Phase1ReviewResult>;
  reviewPhase2ResolvedAccesses(input: {
    cmd: string;
    cwd: string;
    complete: 'y' | 'n';
    accesses: ResolvePhase1AccessesResult['accesses'];
  }): Promise<Phase2ReviewResult>;
}

export interface RunShellReviewOptions {
  workspaceRoot?: string;
  userPrompt?: string;
  reviewEngine?: ShellReviewEngine;
  resolvePhase1Accesses?: (input: ResolvePhase1AccessesInput) => Promise<ResolvePhase1AccessesResult>;
}

export async function runShellReview(
  payload: PreToolUsePayload,
  options: RunShellReviewOptions,
): Promise<PreToolUseHookResult> {
  const command = typeof payload.tool_input.command === 'string' ? payload.tool_input.command : '';
  const workspaceRoot = options.workspaceRoot ?? payload.cwd;
  const reviewEngine = options.reviewEngine;
  if (!reviewEngine) {
    throw new Error('reviewEngine is required');
  }
  const resolveAccesses = options.resolvePhase1Accesses ?? resolvePhase1Accesses;

  const phase1 = await reviewEngine.reviewPhase1ShellCommand({
    userPrompt: options.userPrompt ?? '',
    command,
    workspaceRoot,
    homeDir: homedir(),
    cwd: payload.cwd,
  });

  if (!phase1.allow || !phase1.complete) {
    return deny(phase1.reason);
  }

  const resolved = await resolveAccesses({
    cwd: payload.cwd,
    accesses: phase1.accesses,
  });

  if (!resolved.ok) {
    return deny(resolved.reason ?? 'local path resolution failed');
  }

  if (!resolved.needsPhase2) {
    return allow(phase1.reason);
  }

  const phase2 = await reviewEngine.reviewPhase2ResolvedAccesses({
    cmd: command,
    cwd: payload.cwd,
    complete: 'y',
    accesses: resolved.accesses,
  });

  if (!phase2.allow) {
    return deny(phase2.reason);
  }

  return allow(phase2.reason);
}

export function createShellReviewEngineFromModelConfig(modelConfig: ModelConfig): ShellReviewEngine {
  return createReviewEngine({ modelClient: createModelClient(modelConfig) });
}

function allow(reason: string): PreToolUseHookResult {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  };
}

function deny(reason: string): PreToolUseHookResult {
  return {
    continue: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}
