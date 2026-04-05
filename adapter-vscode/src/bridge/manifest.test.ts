import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBridgeManifestStore } from './manifest.js';

async function createTestRootDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'auto-mode-bridge-test-'));
}

describe('bridge manifest store', () => {
  it('writes and reloads a workspace-scoped bridge manifest', async () => {
    const rootDir = await createTestRootDir();
    const store = createBridgeManifestStore({ rootDir });

    await store.put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    await expect(store.get('/workspace')).resolves.toEqual(
      expect.objectContaining({ port: 43123, token: 'bridge-token' }),
    );
  });

  it('returns null when no manifest exists for a workspace key', async () => {
    const rootDir = await createTestRootDir();
    const store = createBridgeManifestStore({ rootDir });
    await expect(store.get('/missing')).resolves.toBeNull();
  });

  it('normalizes equivalent workspace keys before lookup', async () => {
    const rootDir = await createTestRootDir();
    const store = createBridgeManifestStore({ rootDir });

    await store.put({
      workspaceKey: '/workspace/',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    await expect(store.get('/workspace')).resolves.toEqual(
      expect.objectContaining({ workspaceKey: '/workspace', port: 43123 }),
    );
  });

  it('matches the closest parent workspace manifest for a subdirectory cwd', async () => {
    const rootDir = await createTestRootDir();
    const store = createBridgeManifestStore({ rootDir });

    await store.put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'root-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });
    await store.put({
      workspaceKey: '/workspace/packages/lib',
      port: 43124,
      token: 'lib-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:01:00.000Z',
    });

    await expect(store.getClosest('/workspace/packages/lib/src')).resolves.toEqual(
      expect.objectContaining({ workspaceKey: '/workspace/packages/lib', token: 'lib-token' }),
    );
    await expect(store.getClosest('/workspace/apps/web')).resolves.toEqual(
      expect.objectContaining({ workspaceKey: '/workspace', token: 'root-token' }),
    );
  });

  it('deletes a workspace manifest cleanly', async () => {
    const rootDir = await createTestRootDir();
    const store = createBridgeManifestStore({ rootDir });

    await store.put({
      workspaceKey: '/workspace',
      port: 43123,
      token: 'bridge-token',
      adapterIdentity: 'auto-mode-vscode',
      writtenAt: '2026-04-04T10:00:00.000Z',
    });

    await store.delete('/workspace');
    await expect(store.get('/workspace')).resolves.toBeNull();
  });
});
