import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { sessionContextFilePath } from './runtimePaths.js';
import { createSessionStore } from './sessionStore.js';

async function createTestRootDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'auto-mode-hooks-test-'));
}

describe('session store', () => {
  it('stores and reloads prompt context by session id', async () => {
    const rootDir = await createTestRootDir();
    const store = createSessionStore({ rootDir });

    await store.put({
      sessionId: 'sess-1',
      prompt: '执行外部命令pwd并打印结果',
      cwd: '/workspace',
      transcriptPath: '/tmp/transcript.jsonl',
      storedAt: '2026-04-04T07:42:02.337Z',
    });

    await expect(store.get('sess-1')).resolves.toEqual(
      expect.objectContaining({ prompt: '执行外部命令pwd并打印结果' }),
    );
  });

  it('returns null for unknown sessions', async () => {
    const rootDir = await createTestRootDir();
    const store = createSessionStore({ rootDir });
    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('keeps distinct special-character session ids isolated', async () => {
    const rootDir = await createTestRootDir();
    const store = createSessionStore({ rootDir });

    await store.put({
      sessionId: 'a/b',
      prompt: 'first prompt',
      cwd: '/workspace/a',
      storedAt: '2026-04-04T07:42:02.337Z',
    });
    await store.put({
      sessionId: 'a?b',
      prompt: 'second prompt',
      cwd: '/workspace/b',
      storedAt: '2026-04-04T07:42:03.337Z',
    });

    expect(sessionContextFilePath(rootDir, 'a/b')).not.toBe(sessionContextFilePath(rootDir, 'a?b'));
    await expect(store.get('a/b')).resolves.toEqual(expect.objectContaining({ prompt: 'first prompt' }));
    await expect(store.get('a?b')).resolves.toEqual(expect.objectContaining({ prompt: 'second prompt' }));
  });

  it('fails clearly when a stored session file contains invalid json', async () => {
    const rootDir = await createTestRootDir();
    const store = createSessionStore({ rootDir });
    const filePath = sessionContextFilePath(rootDir, 'sess-bad');

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{not-json', 'utf8');

    await expect(store.get('sess-bad')).rejects.toThrow(/invalid stored session context/i);
  });

  it('fails clearly when stored session content belongs to another session id', async () => {
    const rootDir = await createTestRootDir();
    const store = createSessionStore({ rootDir });
    const filePath = sessionContextFilePath(rootDir, 'sess-1');

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        sessionId: 'sess-2',
        prompt: 'run pwd',
        cwd: '/workspace',
        storedAt: '2026-04-04T07:42:02.337Z',
      })}\n`,
      'utf8',
    );

    await expect(store.get('sess-1')).rejects.toThrow(/invalid stored session context/i);
  });
});
