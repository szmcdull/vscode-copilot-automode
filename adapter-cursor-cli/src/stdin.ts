import { isatty } from 'node:tty';

export function readStdinWithTimeout(stdinStream: NodeJS.ReadableStream, ms: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let finished = false;
    const finish = (value: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(Buffer.concat(chunks).toString('utf8'));
    }, ms);

    stdinStream.resume();
    stdinStream.on('data', (c: string | Buffer) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    stdinStream.on('end', () => {
      finish(Buffer.concat(chunks).toString('utf8'));
    });
    stdinStream.on('error', (err: Error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

export function stdinLooksLikeInteractiveTerminal(
  stdinStream: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
): boolean {
  try {
    return Boolean(stdinStream.isTTY) || isatty(0);
  } catch {
    return Boolean(stdinStream.isTTY);
  }
}

export function parseHookArgv(argv: string[]): { event: 'beforeShellExecution' | 'preToolUse'; skipStdinRead: boolean } {
  const skipStdinRead = argv.includes('--no-stdin');
  const positional = argv.filter((a) => a !== '--no-stdin');
  const event = positional[0] as 'beforeShellExecution' | 'preToolUse';
  return { event, skipStdinRead };
}

export async function readHookStdinPayload(
  stdinStream: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (stdinLooksLikeInteractiveTerminal(stdinStream)) {
    return '';
  }
  const ms = Math.max(100, Number.parseInt(env.AUTO_MODE_HOOK_STDIN_TIMEOUT_MS ?? '2000', 10) || 2000);
  return readStdinWithTimeout(stdinStream, ms);
}
