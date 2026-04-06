import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ModelConfig } from './types.js';

/**
 * Manual live-model smoke test config.
 *
 * File path:
 *   ~/.auto-mode/live-test.json
 *
 * Example:
 * {
 *   "enabled": true,
 *   "provider": "openai",
 *   "model": "gpt-4.1",
 *   "apiKey": "sk-...",
 *   "baseUrl": "https://your-openai-compatible.example.com/v1",
 *   "timeoutMs": 15000,
 *   "maxCases": 3,
 *   "debug": true
 * }
 *
 * Notes:
 * - baseUrl is optional. Omit it to use the provider default public endpoint.
 * - For OpenAI-compatible providers, set provider=openai and point baseUrl to that service.
 * - Environment variables override file values.
 */
export interface LiveTestModelConfig extends ModelConfig {
  maxCases: number;
  debug: boolean;
  configPath: string;
  source: 'env' | 'file' | 'env+file';
}

interface LiveTestFileConfig {
  enabled?: unknown;
  provider?: unknown;
  model?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  timeoutMs?: unknown;
  maxCases?: unknown;
  debug?: unknown;
}

export function getDefaultLiveTestConfigPath(homeDir: string = homedir()): string {
  return path.join(homeDir, '.auto-mode', 'live-test.json');
}

export function readLiveTestModelConfig(options?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
}): LiveTestModelConfig | null {
  const env = options?.env ?? process.env;
  const homeDir = options?.homeDir ?? homedir();
  const configPath = getDefaultLiveTestConfigPath(homeDir);
  const readFile = options?.readFile ?? readFileSync;
  const fileConfig = readOptionalFileConfig(configPath, readFile);
  const envEnabled = readBooleanFlag(env.AUTO_MODE_LIVE_MODEL);
  const fileEnabled = fileConfig?.enabled === true;

  if (!envEnabled && !fileEnabled) {
    return null;
  }

  const provider = readProvider(env.AUTO_MODE_LIVE_PROVIDER ?? fileConfig?.provider);
  const model = readRequiredString(
    env.AUTO_MODE_LIVE_MODEL_NAME ?? fileConfig?.model,
    'live test model name is required',
  );
  const apiKey = readRequiredString(
    env.AUTO_MODE_LIVE_API_KEY ?? fileConfig?.apiKey,
    'live test apiKey is required',
  );
  const baseUrl = readOptionalUrl(env.AUTO_MODE_LIVE_BASE_URL ?? fileConfig?.baseUrl, 'baseUrl');
  const timeoutMs = readPositiveNumber(
    env.AUTO_MODE_LIVE_TIMEOUT_MS ?? fileConfig?.timeoutMs ?? 15_000,
    'timeoutMs',
  );
  const maxCases = readPositiveInteger(env.AUTO_MODE_LIVE_MAX_CASES ?? fileConfig?.maxCases ?? 3, 'maxCases');
  const debug = readBooleanFlag(env.AUTO_MODE_LIVE_DEBUG ?? fileConfig?.debug);

  return {
    provider,
    model,
    apiKey,
    timeoutMs,
    maxCases,
    debug,
    configPath,
    source: envEnabled && fileEnabled ? 'env+file' : envEnabled ? 'env' : 'file',
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function readOptionalFileConfig(
  configPath: string,
  readFile: (filePath: string, encoding: BufferEncoding) => string,
): LiveTestFileConfig | null {
  let raw: string;
  try {
    raw = readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Live test config at ${configPath} must be valid JSON`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Live test config at ${configPath} must be a JSON object`);
  }

  return parsed;
}

function readBooleanFlag(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function readProvider(value: unknown): ModelConfig['provider'] {
  const provider = readRequiredString(value, 'live test provider is required');
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error('live test provider must be one of: anthropic, openai');
  }
  return provider;
}

function readRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}

function readPositiveNumber(value: unknown, key: string): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num <= 0) {
    throw new Error(`live test ${key} must be a positive number`);
  }
  return num;
}

function readPositiveInteger(value: unknown, key: string): number {
  const num = readPositiveNumber(value, key);
  if (!Number.isInteger(num)) {
    throw new Error(`live test ${key} must be an integer`);
  }
  return num;
}

function readOptionalUrl(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`live test ${key} must be a valid URL`);
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`live test ${key} must be a valid URL`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
