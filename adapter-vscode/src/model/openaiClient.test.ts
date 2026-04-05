import { describe, expect, it, vi } from 'vitest';
import { createOpenAIClient } from './openaiClient.js';

describe('openai client', () => {
  it('maps a prompt to an openai chat completions request and returns text', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"decision":"allow","reason":"safe"}',
            },
          },
        ],
      }),
    });

    const client = createOpenAIClient({
      apiKey: 'sk-openai-test',
      model: 'gpt-4.1',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    const text = await client.complete('review this command');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          authorization: 'Bearer sk-openai-test',
        }),
      }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    expect(text).toContain('"decision":"allow"');
    timeoutSpy.mockRestore();
  });

  it('fails on non-2xx responses with a clear error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const client = createOpenAIClient({
      apiKey: 'sk-openai-test',
      model: 'gpt-4.1',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'OpenAI API error: 429 rate limited',
    );
  });

  it('fails when the response does not include a message content string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: {} }],
      }),
    });

    const client = createOpenAIClient({
      apiKey: 'sk-openai-test',
      model: 'gpt-4.1',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'OpenAI response must include a string choices[0].message.content',
    );
  });
});
