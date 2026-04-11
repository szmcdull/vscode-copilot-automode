import { describe, expect, it } from 'vitest';

import { runCursorCliHook } from './hookEntry.js';

describe('runCursorCliHook', () => {
  it('defaults to dry-run allow when no model env is configured', async () => {
    const output = await runCursorCliHook(
      ['node', 'hookEntry.js', 'beforeShellExecution', '--no-stdin'],
      {},
    );

    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        permission: 'allow',
        agentMessage: expect.stringContaining('dry-run'),
      }),
    );
  });

  it('returns deny JSON when review mode is explicit but env is missing', async () => {
    const output = await runCursorCliHook(
      ['node', 'hookEntry.js', 'beforeShellExecution', '--no-stdin'],
      {
        AUTO_MODE_CURSOR_CLI_MODE: 'review',
      },
    );

    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        permission: 'deny',
        agentMessage: expect.stringContaining('misconfigured'),
      }),
    );
  });
});
