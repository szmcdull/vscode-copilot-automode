import type { ModelConfig } from '../../shared/src/model/types.js';

export function readModelConfigFromEnv(env: NodeJS.ProcessEnv): ModelConfig {
  const providerRaw = trim(env.AUTO_MODE_MODEL_PROVIDER) ?? 'anthropic';
  if (providerRaw !== 'anthropic' && providerRaw !== 'openai') {
    throw new Error('AUTO_MODE_MODEL_PROVIDER must be anthropic or openai');
  }

  const model = trim(env.AUTO_MODE_MODEL_NAME);
  if (!model) {
    throw new Error('AUTO_MODE_MODEL_NAME is required');
  }

  const apiKey = trim(env.AUTO_MODE_API_KEY);
  if (!apiKey) {
    throw new Error('AUTO_MODE_API_KEY is required');
  }

  const timeoutRaw = trim(env.AUTO_MODE_MODEL_TIMEOUT_MS);
  const timeoutMs = timeoutRaw !== undefined ? parsePositiveInt(timeoutRaw, 'AUTO_MODE_MODEL_TIMEOUT_MS') : 120000;
  const baseUrl =
    providerRaw === 'anthropic'
      ? readOptionalUrl(trim(env.AUTO_MODE_ANTHROPIC_BASE_URL), 'AUTO_MODE_ANTHROPIC_BASE_URL')
      : readOptionalUrl(trim(env.AUTO_MODE_OPENAI_BASE_URL), 'AUTO_MODE_OPENAI_BASE_URL');

  return {
    provider: providerRaw,
    model,
    apiKey,
    timeoutMs,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function trim(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}

function parsePositiveInt(raw: string, key: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return n;
}

function readOptionalUrl(value: string | undefined, key: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}
