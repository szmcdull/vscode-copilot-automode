import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultLiveTestConfigPath, readLiveTestModelConfig } from './liveTestConfig.js';

describe('live test model config', () => {
  it('returns null when neither env nor file explicitly enables live tests', () => {
    const cfg = readLiveTestModelConfig({
      env: {},
      homeDir: '/home/test',
      readFile: () => JSON.stringify({ enabled: false }),
    });

    expect(cfg).toBeNull();
  });

  it('loads config from file when enabled is true', () => {
    const cfg = readLiveTestModelConfig({
      env: {},
      homeDir: '/home/test',
      readFile: () =>
        JSON.stringify({
          enabled: true,
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          apiKey: 'sk-test',
          timeoutMs: 9000,
          maxCases: 2,
        debug: true,
        }),
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        apiKey: 'sk-test',
        timeoutMs: 9000,
        maxCases: 2,
        debug: true,
        source: 'file',
        configPath: '/home/test/.auto-mode/live-test.json',
      }),
    );
  });

  it('prefers env vars over file values', () => {
    const cfg = readLiveTestModelConfig({
      env: {
        AUTO_MODE_LIVE_MODEL: '1',
        AUTO_MODE_LIVE_PROVIDER: 'openai',
        AUTO_MODE_LIVE_MODEL_NAME: 'gpt-4.1',
        AUTO_MODE_LIVE_API_KEY: 'sk-env',
        AUTO_MODE_LIVE_TIMEOUT_MS: '7000',
        AUTO_MODE_LIVE_MAX_CASES: '1',
      },
      homeDir: '/home/test',
      readFile: () =>
        JSON.stringify({
          enabled: true,
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          apiKey: 'sk-file',
          timeoutMs: 9000,
          maxCases: 3,
        }),
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-env',
        timeoutMs: 7000,
        maxCases: 1,
        debug: false,
        source: 'env+file',
      }),
    );
  });

  it('supports env-only enablement', () => {
    const cfg = readLiveTestModelConfig({
      env: {
        AUTO_MODE_LIVE_MODEL: 'true',
        AUTO_MODE_LIVE_PROVIDER: 'anthropic',
        AUTO_MODE_LIVE_MODEL_NAME: 'claude-3-7-sonnet-latest',
        AUTO_MODE_LIVE_API_KEY: 'sk-env',
      },
      homeDir: '/home/test',
      readFile: () => {
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        apiKey: 'sk-env',
        timeoutMs: 15000,
        maxCases: 3,
        debug: false,
        source: 'env',
      }),
    );
  });

  it('supports debug override from env', () => {
    const cfg = readLiveTestModelConfig({
      env: {
        AUTO_MODE_LIVE_MODEL: '1',
        AUTO_MODE_LIVE_PROVIDER: 'anthropic',
        AUTO_MODE_LIVE_MODEL_NAME: 'claude-3-7-sonnet-latest',
        AUTO_MODE_LIVE_API_KEY: 'sk-env',
        AUTO_MODE_LIVE_DEBUG: 'true',
      },
      homeDir: '/home/test',
      readFile: () => JSON.stringify({ enabled: true, debug: false }),
    });

    expect(cfg).toEqual(expect.objectContaining({ debug: true }));
  });

  it('fails on invalid JSON in the config file', () => {
    expect(() =>
      readLiveTestModelConfig({
        env: {},
        homeDir: '/home/test',
        readFile: () => '{',
      }),
    ).toThrow('Live test config at /home/test/.auto-mode/live-test.json must be valid JSON');
  });

  it('fails when enabled live config is missing required fields', () => {
    expect(() =>
      readLiveTestModelConfig({
        env: {},
        homeDir: '/home/test',
        readFile: () => JSON.stringify({ enabled: true, provider: 'anthropic' }),
      }),
    ).toThrow('live test model name is required');
  });

  it('fails when maxCases is not a positive integer', () => {
    expect(() =>
      readLiveTestModelConfig({
        env: {},
        homeDir: '/home/test',
        readFile: () =>
          JSON.stringify({
            enabled: true,
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-latest',
            apiKey: 'sk-test',
            maxCases: 1.5,
          }),
      }),
    ).toThrow('live test maxCases must be an integer');
  });

  it('builds the default config path under the user home directory', () => {
    expect(getDefaultLiveTestConfigPath('/tmp/home')).toBe(
      path.join('/tmp/home', '.auto-mode', 'live-test.json'),
    );
  });
});
