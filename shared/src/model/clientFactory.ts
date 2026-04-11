import { createAnthropicClient } from './anthropicClient.js';
import { createOpenAIClient } from './openaiClient.js';
import type { ModelClient, ModelConfig } from './types.js';

export function createModelClient(
  config: ModelConfig,
  options: {
    fetchImpl?: typeof fetch;
  } = {},
): ModelClient {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicClient({
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
        fetchImpl: options.fetchImpl,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      });
    case 'openai':
      return createOpenAIClient({
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.timeoutMs,
        fetchImpl: options.fetchImpl,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      });
  }
}
