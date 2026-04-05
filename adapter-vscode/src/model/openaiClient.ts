import type { ModelClient } from './types.js';

export function createOpenAIClient(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): ModelClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = readPositiveTimeout(options.timeoutMs);

  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI API error: ${res.status} ${errText}`);
      }

      const data = (await res.json()) as unknown;
      const text = readMessageContent(data);
      return text;
    },
  };
}

function readPositiveTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive number');
  }

  return timeoutMs;
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl ?? 'https://api.openai.com/v1';
  if (raw.trim() === '') {
    throw new Error('baseUrl must be a valid URL');
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('baseUrl must be a valid URL');
  }
}

function readMessageContent(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    throw new Error('OpenAI response must include a string choices[0].message.content');
  }

  const firstChoice = data.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error('OpenAI response must include a string choices[0].message.content');
  }

  const content = firstChoice.message.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('OpenAI response must include a string choices[0].message.content');
  }

  return content;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
