import { describe, expect, it } from 'vitest';

import { readModelConfigFromEnv } from './modelConfigFromEnv.js';

describe('readModelConfigFromEnv', () => {
  it('loads minimal anthropic config', () => {
    const cfg = readModelConfigFromEnv({
      AUTO_MODE_API_KEY: 'sk-test',
      AUTO_MODE_MODEL_NAME: 'claude-3-7-sonnet-latest',
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        apiKey: 'sk-test',
        timeoutMs: 120000,
      }),
    );
  });

  it('loads openai config and base URL', () => {
    const cfg = readModelConfigFromEnv({
      AUTO_MODE_MODEL_PROVIDER: 'openai',
      AUTO_MODE_MODEL_NAME: 'gpt-4.1',
      AUTO_MODE_API_KEY: 'sk-openai',
      AUTO_MODE_OPENAI_BASE_URL: 'https://api.openai.com/v1',
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4.1',
        baseUrl: 'https://api.openai.com/v1',
      }),
    );
  });

  it('fails when api key missing', () => {
    expect(() =>
      readModelConfigFromEnv({
        AUTO_MODE_MODEL_NAME: 'claude-3-7-sonnet-latest',
      }),
    ).toThrow('AUTO_MODE_API_KEY is required');
  });
});
