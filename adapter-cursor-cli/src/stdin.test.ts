import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { parseHookArgv, readStdinWithTimeout } from './stdin.js';

describe('parseHookArgv', () => {
  it('parses event and --no-stdin in any order', () => {
    expect(parseHookArgv(['beforeShellExecution', '--no-stdin'])).toEqual({
      event: 'beforeShellExecution',
      skipStdinRead: true,
    });
    expect(parseHookArgv(['--no-stdin', 'preToolUse'])).toEqual({
      event: 'preToolUse',
      skipStdinRead: true,
    });
  });
});

describe('readStdinWithTimeout', () => {
  it('resolves full payload when stream ends', async () => {
    const stream = new PassThrough();
    const result = readStdinWithTimeout(stream, 5000);
    stream.end('{"a":1}');
    await expect(result).resolves.toBe('{"a":1}');
  });

  it('resolves partial buffer after timeout when end never fires', async () => {
    const stream = new PassThrough();
    const result = readStdinWithTimeout(stream, 20);
    stream.write('partial');
    await expect(result).resolves.toBe('partial');
  });
});
