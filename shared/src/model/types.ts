export interface BaseModelConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
}

export interface AnthropicModelConfig extends BaseModelConfig {
  provider: 'anthropic';
}

export interface OpenAIModelConfig extends BaseModelConfig {
  provider: 'openai';
}

export type ModelConfig = AnthropicModelConfig | OpenAIModelConfig;

export interface ModelClient {
  complete(prompt: string): Promise<string>;
}
