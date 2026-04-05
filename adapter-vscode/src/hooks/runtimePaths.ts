import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Directory under the hook runtime root where per-session JSON files are stored.
 * Keeps session blobs separate from future Task 3+ artifacts (e.g. tool-use links).
 */
export function hookRuntimeSessionsDir(rootDir: string): string {
  return path.join(rootDir, 'sessions');
}

export function sessionContextFilePath(rootDir: string, sessionId: string): string {
  const digest = createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return path.join(hookRuntimeSessionsDir(rootDir), `${digest}.json`);
}

export function hookRuntimeToolUseLinksDir(rootDir: string): string {
  return path.join(rootDir, 'tool-use-links');
}

/** One file per (session, tool_use_id) pair so concurrent sessions sharing a runtime root cannot clobber each other. */
export function toolUseLinkFilePath(rootDir: string, sessionId: string, toolUseId: string): string {
  const digest = createHash('sha256')
    .update(sessionId, 'utf8')
    .update('\0', 'utf8')
    .update(toolUseId, 'utf8')
    .digest('hex');
  return path.join(hookRuntimeToolUseLinksDir(rootDir), `${digest}.json`);
}
