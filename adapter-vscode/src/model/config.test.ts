import { describe, expect, it } from 'vitest';
import { readModelConfig } from './config.js';

describe('model config', () => {
  it('loads an anthropic provider config from extension settings', () => {
    const cfg = readModelConfig((key) =>
      ({
        'autoMode.modelProvider': 'anthropic',
        'autoMode.modelName': 'claude-3-7-sonnet-latest',
        'autoMode.apiKey': 'sk-test',
      })[key],
    );

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
      }),
    );
  });

  it('loads an openai provider config from extension settings', () => {
    const cfg = readModelConfig((key) =>
      ({
        'autoMode.modelProvider': 'openai',
        'autoMode.modelName': 'gpt-4.1',
        'autoMode.apiKey': 'sk-openai-test',
        'autoMode.openaiBaseUrl': 'https://api.openai.com/v1',
      })[key],
    );

    expect(cfg).toEqual(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'sk-openai-test',
        baseUrl: 'https://api.openai.com/v1',
      }),
    );
  });

  it('fails when the API key is missing', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'anthropic',
          'autoMode.modelName': 'claude-3-7-sonnet-latest',
        })[key],
      ),
    ).toThrow('autoMode.apiKey is required');
  });

  it('fails when the provider is unsupported', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'gemini',
          'autoMode.modelName': 'gemini-2.5-pro',
          'autoMode.apiKey': 'sk-test',
        })[key],
      ),
    ).toThrow('autoMode.modelProvider must be one of: anthropic, openai');
  });

  it('fails when the model name is missing', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'anthropic',
          'autoMode.apiKey': 'sk-test',
        })[key],
      ),
    ).toThrow('autoMode.modelName is required');
  });

  it('fails when modelTimeoutMs is invalid', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'anthropic',
          'autoMode.modelName': 'claude-3-7-sonnet-latest',
          'autoMode.apiKey': 'sk-test',
          'autoMode.modelTimeoutMs': -1,
        })[key],
      ),
    ).toThrow('autoMode.modelTimeoutMs must be a positive number');
  });

  it('fails when anthropicBaseUrl is blank', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'anthropic',
          'autoMode.modelName': 'claude-3-7-sonnet-latest',
          'autoMode.apiKey': 'sk-test',
          'autoMode.anthropicBaseUrl': '   ',
        })[key],
      ),
    ).toThrow('autoMode.anthropicBaseUrl must be a valid URL');
  });

  it('fails when anthropicBaseUrl is not a valid URL', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'anthropic',
          'autoMode.modelName': 'claude-3-7-sonnet-latest',
          'autoMode.apiKey': 'sk-test',
          'autoMode.anthropicBaseUrl': 'not a url',
        })[key],
      ),
    ).toThrow('autoMode.anthropicBaseUrl must be a valid URL');
  });

  it('fails when openaiBaseUrl is blank', () => {
    expect(() =>
      readModelConfig((key) =>
        ({
          'autoMode.modelProvider': 'openai',
          'autoMode.modelName': 'gpt-4.1',
          'autoMode.apiKey': 'sk-openai-test',
          'autoMode.openaiBaseUrl': '   ',
        })[key],
      ),
    ).toThrow('autoMode.openaiBaseUrl must be a valid URL');
  });
});
