import { describe, expect, it } from 'vitest';
import { assertUserPromptSubmitPayload } from './types.js';

describe('UserPromptSubmit payload validation', () => {
  it('accepts payloads with required cwd and timestamp strings', () => {
    expect(
      assertUserPromptSubmitPayload({
        session_id: 'sess-1',
        prompt: 'run pwd',
        cwd: '/workspace',
        timestamp: '2026-04-04T07:42:02.337Z',
      }),
    ).toEqual({
      session_id: 'sess-1',
      prompt: 'run pwd',
      cwd: '/workspace',
      timestamp: '2026-04-04T07:42:02.337Z',
      transcript_path: undefined,
    });
  });

  it('rejects payloads missing cwd', () => {
    expect(() =>
      assertUserPromptSubmitPayload({
        session_id: 'sess-1',
        prompt: 'run pwd',
        timestamp: '2026-04-04T07:42:02.337Z',
      }),
    ).toThrow('invalid UserPromptSubmit payload');
  });

  it('rejects payloads missing timestamp', () => {
    expect(() =>
      assertUserPromptSubmitPayload({
        session_id: 'sess-1',
        prompt: 'run pwd',
        cwd: '/workspace',
      }),
    ).toThrow('invalid UserPromptSubmit payload');
  });

  it('rejects payloads with non-string transcript_path', () => {
    expect(() =>
      assertUserPromptSubmitPayload({
        session_id: 'sess-1',
        prompt: 'run pwd',
        cwd: '/workspace',
        timestamp: '2026-04-04T07:42:02.337Z',
        transcript_path: 123,
      }),
    ).toThrow('invalid UserPromptSubmit payload');
  });
});
