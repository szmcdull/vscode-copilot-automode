import type { ModelConfig } from './types.js';

export function readModelConfig(get: (key: string) => unknown): ModelConfig {
  const providerRaw = asTrimmedString(get('autoMode.modelProvider')) ?? 'anthropic';
  if (providerRaw !== 'anthropic' && providerRaw !== 'openai') {
    throw new Error('autoMode.modelProvider must be one of: anthropic, openai');
  }

  const model = asTrimmedString(get('autoMode.modelName'));
  if (!model) {
    throw new Error('autoMode.modelName is required');
  }

  const apiKey = asTrimmedString(get('autoMode.apiKey'));
  if (!apiKey) {
    throw new Error('autoMode.apiKey is required');
  }

  const baseUrl =
    providerRaw === 'anthropic'
      ? readOptionalUrl(get('autoMode.anthropicBaseUrl'), 'autoMode.anthropicBaseUrl')
      : readOptionalUrl(get('autoMode.openaiBaseUrl'), 'autoMode.openaiBaseUrl');
  const timeoutMs = readPositiveNumber(get('autoMode.modelTimeoutMs'), 'autoMode.modelTimeoutMs') ?? 120_000;

  return {
    provider: providerRaw,
    model,
    apiKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    timeoutMs,
  };
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readPositiveNumber(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }

  return value;
}

function readOptionalUrl(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a valid URL`);
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}
