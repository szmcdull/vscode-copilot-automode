export function createAnthropicClient(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): {
  complete(prompt: string): Promise<string>;
} {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = readPositiveTimeout(options.timeoutMs);

  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetchImpl(`${base}/v1/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API error: ${res.status} ${errText}`);
      }

      const data = (await res.json()) as unknown;
      const blocks = readContentBlocks(data);
      const text = readTextFromBlocks(blocks);

      if (text === '') {
        throw new Error('Anthropic response did not include any text content blocks');
      }

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
  const raw = baseUrl ?? 'https://api.anthropic.com';
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

function readContentBlocks(data: unknown): Array<unknown> {
  if (!isRecord(data) || !Array.isArray(data.content)) {
    throw new Error('Anthropic response content must be an array');
  }

  return data.content;
}

function readTextFromBlocks(blocks: Array<unknown>): string {
  let sawTextBlock = false;
  const textParts: Array<string> = [];

  for (const block of blocks) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type !== 'text') {
      continue;
    }

    sawTextBlock = true;
    if (typeof block.text !== 'string') {
      throw new Error('Anthropic text content block must include a text field');
    }

    textParts.push(block.text);
  }

  if (!sawTextBlock) {
    return '';
  }

  return textParts.join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
