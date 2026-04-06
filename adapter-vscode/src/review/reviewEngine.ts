import {
  buildPhase1ShellReviewPrompt,
  buildPhase2ResolvedAccessReviewPrompt,
  buildShellReviewPrompt,
  type Phase1Access,
  type Phase1ReviewResult,
  type Phase2ResolvedAccess,
  type Phase2ResolvedAccessReviewInput,
  type Phase2ReviewResult,
  type ShellReviewInput,
} from './reviewPrompt.js';

export type {
  Phase1Access,
  Phase1ReviewResult,
  Phase2ResolvedAccess,
  Phase2ResolvedAccessReviewInput,
  Phase2ReviewResult,
  ShellReviewInput,
};

const HOST_ACTIONS = ['allow', 'deny', 'ask'] as const;
const RAW_DECISIONS = [...HOST_ACTIONS, 'allow_with_constraints'] as const;

export type HostPermissionAction = (typeof HOST_ACTIONS)[number];
export type RawModelDecision = (typeof RAW_DECISIONS)[number];

export interface ShellReviewResult {
  finalAction: HostPermissionAction;
  reason: string;
  rawModelDecision: RawModelDecision;
  degradedFromConstraints: boolean;
}

export function createReviewEngine(options: {
  modelClient: { complete(prompt: string): Promise<string> };
}) {
  return {
    // Legacy single-phase contract for current host allow/deny/ask decisions.
    async reviewShellCommand(input: ShellReviewInput): Promise<ShellReviewResult> {
      const prompt = buildShellReviewPrompt(input);
      const text = await options.modelClient.complete(prompt);
      const parsed = parseReviewModelJson(text);
      const rawModelDecision = parsed.decision;
      const degradedFromConstraints = rawModelDecision === 'allow_with_constraints';
      const finalAction = contractToHostAction(rawModelDecision);
      const reason = degradedFromConstraints
        ? `${parsed.reason} The current host path does not execute review constraints, so this result is downgraded to ask.`
        : parsed.reason;

      return {
        finalAction,
        reason,
        rawModelDecision,
        degradedFromConstraints,
      };
    },

    // Phase 1 extracts provisional allow plus filesystem access facts.
    async reviewPhase1ShellCommand(input: ShellReviewInput): Promise<Phase1ReviewResult> {
      const prompt = buildPhase1ShellReviewPrompt(input);
      const text = await options.modelClient.complete(prompt);
      return parsePhase1ReviewModelJson(text);
    },

    // Phase 2 judges resolved accesses and fails closed on incomplete input.
    async reviewPhase2ResolvedAccesses(
      input: Phase2ResolvedAccessReviewInput,
    ): Promise<Phase2ReviewResult> {
      validatePhase2ReviewInput(input);
      if (input.complete === 'n') {
        return {
          allow: false,
          reason: 'Phase 2 review input is incomplete, so the result is denied.',
        };
      }

      const prompt = buildPhase2ResolvedAccessReviewPrompt(input);
      const text = await options.modelClient.complete(prompt);
      return parsePhase2ReviewModelJson(text);
    },
  };
}

function contractToHostAction(raw: RawModelDecision): HostPermissionAction {
  if (raw === 'allow_with_constraints') {
    return 'ask';
  }

  return raw;
}

function parsePhase1ReviewModelJson(text: string): Phase1ReviewResult {
  const jsonText = extractJsonPayload(text.trim());
  let data: unknown;

  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Phase 1 review model output is not valid JSON');
  }

  if (!isRecord(data)) {
    throw new Error('Phase 1 review model JSON must be an object');
  }

  const allow = data.allow;
  const complete = data.complete;
  const reason = data.reason;
  const accesses = data.accesses;

  if (allow !== 'y' && allow !== 'n') {
    throw new Error('Phase 1 review model JSON must include "allow" as "y" or "n"');
  }

  if (complete !== 'y' && complete !== 'n') {
    throw new Error('Phase 1 review model JSON must include "complete" as "y" or "n"');
  }

  if (typeof reason !== 'string') {
    throw new Error('Phase 1 review model JSON must include string "reason"');
  }

  if (reason.trim() === '') {
    throw new Error('Phase 1 review model JSON must include a non-empty string "reason"');
  }

  if (allow === 'y' && complete === 'n') {
    throw new Error('Phase 1 review model JSON must not return allow:"y" with complete:"n"');
  }

  if (!Array.isArray(accesses)) {
    throw new Error('Phase 1 review model JSON must include array "accesses"');
  }

  const parsedAccesses: Phase1Access[] = [];

  for (const item of accesses) {
    if (!isRecord(item)) {
      throw new Error('Phase 1 review model accesses must be objects');
    }

    const kind = item.kind;
    const path = item.path;
    const glob = item.glob;

    if (kind !== 'r' && kind !== 'w' && kind !== 'del') {
      throw new Error(`Invalid phase 1 access kind: ${String(kind)}`);
    }

    if (typeof path !== 'string') {
      throw new Error('Phase 1 review model access must include string "path"');
    }

    if (glob !== 'y' && glob !== 'n') {
      throw new Error('Phase 1 review model access must include "glob" as "y" or "n"');
    }

    parsedAccesses.push({
      kind,
      path,
      glob: glob === 'y',
    });
  }

  return {
    allow: allow === 'y',
    complete: complete === 'y',
    reason: reason.trim(),
    accesses: parsedAccesses,
  };
}

function parsePhase2ReviewModelJson(text: string): Phase2ReviewResult {
  const jsonText = extractJsonPayload(text.trim());
  let data: unknown;

  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Phase 2 review model output is not valid JSON');
  }

  if (!isRecord(data)) {
    throw new Error('Phase 2 review model JSON must be an object');
  }

  const allow = data.allow;
  const reason = data.reason;

  if (allow !== 'y' && allow !== 'n') {
    throw new Error('Phase 2 review model JSON must include "allow" as "y" or "n"');
  }

  if (typeof reason !== 'string') {
    throw new Error('Phase 2 review model JSON must include string "reason"');
  }

  if (reason.trim() === '') {
    throw new Error('Phase 2 review model JSON must include a non-empty string "reason"');
  }

  return {
    allow: allow === 'y',
    reason: reason.trim(),
  };
}

function validatePhase2ReviewInput(input: unknown): asserts input is Phase2ResolvedAccessReviewInput {
  if (!isRecord(input)) {
    throw new Error('Phase 2 review input must be an object');
  }

  assertNonEmptyString(input.cmd, 'Phase 2 review input must include non-empty string "cmd"');
  assertNonEmptyString(input.cwd, 'Phase 2 review input must include non-empty string "cwd"');

  if (input.complete !== 'y' && input.complete !== 'n') {
    throw new Error('Phase 2 review input must include "complete" as "y" or "n"');
  }

  if (!Array.isArray(input.accesses)) {
    throw new Error('Phase 2 review input must include array "accesses"');
  }

  for (const access of input.accesses) {
    validatePhase2ResolvedAccessInput(access);
  }
}

function validatePhase2ResolvedAccessInput(access: unknown): asserts access is Phase2ResolvedAccess {
  if (!isRecord(access)) {
    throw new Error('Phase 2 review input accesses must be objects');
  }

  if (access.kind !== 'r' && access.kind !== 'w' && access.kind !== 'del') {
    throw new Error('Phase 2 review input access must include "kind" as "r", "w", or "del"');
  }

  assertNonEmptyString(
    access.path,
    'Phase 2 review input access must include non-empty string "path"',
  );
  assertNonEmptyString(
    access.expanded,
    'Phase 2 review input access must include non-empty string "expanded"',
  );
  assertNonEmptyString(
    access.real,
    'Phase 2 review input access must include non-empty string "real"',
  );

  if (access.symlink !== 'y' && access.symlink !== 'n') {
    throw new Error('Phase 2 review input access must include "symlink" as "y" or "n"');
  }

  if (access.real_from !== 'target' && access.real_from !== 'parent') {
    throw new Error(
      'Phase 2 review input access must include "real_from" as "target" or "parent"',
    );
  }
}

function parseReviewModelJson(text: string): { decision: RawModelDecision; reason: string } {
  const jsonText = extractJsonPayload(text.trim());
  let data: unknown;

  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Review model output is not valid JSON');
  }

  if (!isRecord(data)) {
    throw new Error('Review model JSON must be an object');
  }

  const decision = data.decision;
  const reason = data.reason;

  if (typeof decision !== 'string') {
    throw new Error('Review model JSON must include string "decision"');
  }

  if (typeof reason !== 'string') {
    throw new Error('Review model JSON must include string "reason"');
  }

  if (!isRawModelDecision(decision)) {
    throw new Error(`Invalid review decision: ${decision}`);
  }

  if (reason.trim() === '') {
    throw new Error('Review model JSON must include a non-empty string "reason"');
  }

  return { decision, reason: reason.trim() };
}

function extractJsonPayload(trimmed: string): string {
  if (trimmed === '') {
    return trimmed;
  }

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  const lines = trimmed.split('\n');
  if (lines.length < 3) {
    throw new Error('Review model output fence is not closed');
  }

  const openingFence = lines[0].trim();
  const closingFence = lines.at(-1)?.trim();

  if (!/^```(?:json)?$/i.test(openingFence)) {
    throw new Error('Review model output fence must be ``` or ```json');
  }

  if (closingFence !== '```') {
    throw new Error('Review model output fence is not closed');
  }

  return lines.slice(1, -1).join('\n').trim();
}

function isRawModelDecision(value: string): value is RawModelDecision {
  return (RAW_DECISIONS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
}

export {
  createShellQuarantineStore,
  type ShellDenyKind,
  type ShellQuarantineKey,
  type ShellQuarantineStore,
} from './shellQuarantineStore.js';
