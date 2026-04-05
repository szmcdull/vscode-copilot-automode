import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { sessionContextFilePath } from './runtimePaths.js';

export interface StoredPromptContext {
  sessionId: string;
  prompt: string;
  cwd: string;
  transcriptPath?: string;
  storedAt: string;
}

export interface SessionStore {
  put(context: StoredPromptContext): Promise<void>;
  get(sessionId: string): Promise<StoredPromptContext | null>;
}

export interface CreateSessionStoreOptions {
  rootDir: string;
}

function isStoredPromptContext(value: unknown): value is StoredPromptContext {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.sessionId === 'string' &&
    typeof o.prompt === 'string' &&
    typeof o.cwd === 'string' &&
    typeof o.storedAt === 'string' &&
    (o.transcriptPath === undefined || typeof o.transcriptPath === 'string')
  );
}

function assertStoredPromptContext(value: unknown, sessionId: string): StoredPromptContext {
  if (!isStoredPromptContext(value)) {
    throw new Error(`invalid stored session context for session ${sessionId}`);
  }
  if (value.sessionId !== sessionId) {
    throw new Error(`invalid stored session context for session ${sessionId}`);
  }
  return value;
}

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const { rootDir } = options;

  return {
    async put(context: StoredPromptContext): Promise<void> {
      assertStoredPromptContext(context, context.sessionId);
      const filePath = sessionContextFilePath(rootDir, context.sessionId);
      const dirPath = path.dirname(filePath);
      const tempPath = path.join(dirPath, `${path.basename(filePath)}.${randomUUID()}.tmp`);

      await mkdir(dirPath, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
      try {
        await rename(tempPath, filePath);
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    },

    async get(sessionId: string): Promise<StoredPromptContext | null> {
      const filePath = sessionContextFilePath(rootDir, sessionId);
      try {
        const raw = await readFile(filePath, 'utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          throw new Error(`invalid stored session context for session ${sessionId}`);
        }
        return assertStoredPromptContext(parsed, sessionId);
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string';
}
