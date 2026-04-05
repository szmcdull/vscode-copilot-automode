import { createHash } from 'node:crypto';
import path from 'node:path';

export function bridgeManifestsDir(rootDir: string): string {
  return path.join(rootDir, 'bridge-manifests');
}

export function normalizeWorkspaceKey(workspaceKey: string): string {
  if (workspaceKey === '/') {
    return workspaceKey;
  }

  const normalized = workspaceKey.replace(/\/+$/u, '');
  return normalized === '' ? '/' : normalized;
}

export function bridgeManifestFilePath(rootDir: string, workspaceKey: string): string {
  const digest = createHash('sha256').update(normalizeWorkspaceKey(workspaceKey), 'utf8').digest('hex');
  return path.join(bridgeManifestsDir(rootDir), `${digest}.json`);
}
