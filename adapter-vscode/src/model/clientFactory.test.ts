import { describe, expect, it, vi } from 'vitest';
import { createModelClient } from './clientFactory.js';
import type { ModelConfig } from './types.js';

describe('model client factory', () => {
  it('creates an openai-backed client for openai config', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'openai-ok' } }],
      }),
    });

    const cfg: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: 'sk-openai-test',
      timeoutMs: 5_000,
    };

    const client = createModelClient(cfg, { fetchImpl: fetchImpl as any });
    await expect(client.complete('hello')).resolves.toBe('openai-ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.any(Object),
    );
  });
});
