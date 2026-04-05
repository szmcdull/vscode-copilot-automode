import { buildShellReviewPrompt, type ShellReviewInput } from './reviewPrompt.js';

export type { ShellReviewInput };

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
  };
}

function contractToHostAction(raw: RawModelDecision): HostPermissionAction {
  if (raw === 'allow_with_constraints') {
    return 'ask';
  }

  return raw;
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
