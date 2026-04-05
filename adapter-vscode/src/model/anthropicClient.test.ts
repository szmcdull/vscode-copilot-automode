import { describe, expect, it, vi } from 'vitest';
import { createAnthropicClient } from './anthropicClient.js';

describe('anthropic client', () => {
  it('maps a prompt to an anthropic messages request and returns text', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"decision":"deny","reason":"dangerous"}' }],
      }),
    });

    const client = createAnthropicClient({
      apiKey: 'sk-test',
      model: 'claude-3-7-sonnet-latest',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    const text = await client.complete('review this command');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    expect(text).toContain('"decision":"deny"');
    timeoutSpy.mockRestore();
  });

  it('fails on non-2xx responses with a clear error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });

    const client = createAnthropicClient({
      apiKey: 'sk-test',
      model: 'claude-3-7-sonnet-latest',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'Anthropic API error: 401 unauthorized',
    );
  });

  it('fails when the response has no valid text block', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', id: 'tool-1' }],
      }),
    });

    const client = createAnthropicClient({
      apiKey: 'sk-test',
      model: 'claude-3-7-sonnet-latest',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'Anthropic response did not include any text content blocks',
    );
  });

  it('fails when the response content field is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const client = createAnthropicClient({
      apiKey: 'sk-test',
      model: 'claude-3-7-sonnet-latest',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'Anthropic response content must be an array',
    );
  });

  it('fails when content mixes a valid text block with a malformed text block', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'valid text' },
          { type: 'text' },
        ],
      }),
    });

    const client = createAnthropicClient({
      apiKey: 'sk-test',
      model: 'claude-3-7-sonnet-latest',
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as any,
    });

    await expect(client.complete('review this command')).rejects.toThrow(
      'Anthropic text content block must include a text field',
    );
  });
});
