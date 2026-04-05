import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { BridgeManifest } from './types.js';
import { bridgeManifestFilePath, normalizeWorkspaceKey } from './runtimePaths.js';

export type { BridgeManifest } from './types.js';

export interface BridgeManifestStore {
  put(manifest: BridgeManifest): Promise<void>;
  get(workspaceKey: string): Promise<BridgeManifest | null>;
  getClosest(workspacePath: string): Promise<BridgeManifest | null>;
  delete(workspaceKey: string): Promise<void>;
}

export interface CreateBridgeManifestStoreOptions {
  rootDir: string;
}

function isBridgeManifest(value: unknown): value is BridgeManifest {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.workspaceKey === 'string' &&
    typeof o.port === 'number' &&
    typeof o.token === 'string' &&
    typeof o.adapterIdentity === 'string' &&
    typeof o.writtenAt === 'string'
  );
}

function assertBridgeManifest(value: unknown, workspaceKey: string): BridgeManifest {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  if (!isBridgeManifest(value)) {
    throw new Error(`invalid bridge manifest for workspace ${normalizedWorkspaceKey}`);
  }
  if (normalizeWorkspaceKey(value.workspaceKey) !== normalizedWorkspaceKey) {
    throw new Error(`invalid bridge manifest for workspace ${normalizedWorkspaceKey}`);
  }
  return {
    ...value,
    workspaceKey: normalizedWorkspaceKey,
  };
}

export function createBridgeManifestStore(options: CreateBridgeManifestStoreOptions): BridgeManifestStore {
  const { rootDir } = options;

  async function readManifest(workspaceKey: string): Promise<BridgeManifest | null> {
    const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
    const filePath = bridgeManifestFilePath(rootDir, normalizedWorkspaceKey);
    try {
      const raw = await readFile(filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`invalid bridge manifest for workspace ${normalizedWorkspaceKey}`);
      }
      return assertBridgeManifest(parsed, normalizedWorkspaceKey);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  return {
    async put(manifest: BridgeManifest): Promise<void> {
      const normalizedManifest = assertBridgeManifest(manifest, manifest.workspaceKey);
      const filePath = bridgeManifestFilePath(rootDir, normalizedManifest.workspaceKey);
      const dirPath = path.dirname(filePath);
      const tempPath = path.join(dirPath, `${path.basename(filePath)}.${randomUUID()}.tmp`);

      await mkdir(dirPath, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`, 'utf8');
      try {
        await rename(tempPath, filePath);
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    },

    async get(workspaceKey: string): Promise<BridgeManifest | null> {
      return readManifest(workspaceKey);
    },

    async getClosest(workspacePath: string): Promise<BridgeManifest | null> {
      for (const candidate of workspaceKeyCandidates(workspacePath)) {
        try {
          const manifest = await readManifest(candidate);
          if (manifest) {
            return manifest;
          }
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            error.message === `invalid bridge manifest for workspace ${normalizeWorkspaceKey(candidate)}`
          ) {
            await rm(bridgeManifestFilePath(rootDir, candidate), { force: true }).catch(() => undefined);
            continue;
          }
          throw error;
        }
      }
      return null;
    },

    async delete(workspaceKey: string): Promise<void> {
      const filePath = bridgeManifestFilePath(rootDir, workspaceKey);
      await rm(filePath, { force: true }).catch((err: unknown) => {
        if (isNodeError(err) && err.code === 'ENOENT') {
          return;
        }
        throw err;
      });
    },
  };
}

function workspaceKeyCandidates(workspacePath: string): string[] {
  const candidates: string[] = [];
  let current = normalizeWorkspaceKey(workspacePath);

  while (true) {
    candidates.push(current);
    if (current === '/') {
      return candidates;
    }

    const parent = normalizeWorkspaceKey(path.dirname(current));
    if (parent === current) {
      return candidates;
    }
    current = parent;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string';
}
