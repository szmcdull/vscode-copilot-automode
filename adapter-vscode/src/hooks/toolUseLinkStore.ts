import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { ReviewResultKind, ToolUseLinkData, ToolUseLinkStore } from './preToolUse.js';
import { toolUseLinkFilePath } from './runtimePaths.js';

export interface CreateToolUseLinkStoreOptions {
  rootDir: string;
}

interface StoredLink {
  tool_use_id: string;
  request_id: string;
  session_id: string;
  needs_user_decision_approve?: boolean;
  review_result_kind?: ReviewResultKind;
}

function isReviewResultKind(v: unknown): v is ReviewResultKind | undefined {
  return v === undefined || v === 'local_review';
}

function isStoredLink(value: unknown, toolUseId: string): value is StoredLink {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  const needsOk =
    o.needs_user_decision_approve === undefined || typeof o.needs_user_decision_approve === 'boolean';
  return (
    typeof o.tool_use_id === 'string' &&
    typeof o.request_id === 'string' &&
    typeof o.session_id === 'string' &&
    o.tool_use_id === toolUseId &&
    needsOk &&
    isReviewResultKind(o.review_result_kind)
  );
}

export function createToolUseLinkStore(options: CreateToolUseLinkStoreOptions): ToolUseLinkStore {
  const { rootDir } = options;

  return {
    async put(
      toolUseId: string,
      requestId: string,
      sessionId: string,
      putOptions?: { needsUserDecisionApprove?: boolean; reviewResultKind?: ReviewResultKind },
    ): Promise<void> {
      const filePath = toolUseLinkFilePath(rootDir, sessionId, toolUseId);
      const dirPath = path.dirname(filePath);
      const tempPath = path.join(dirPath, `${path.basename(filePath)}.${randomUUID()}.tmp`);
      const kind: ReviewResultKind = putOptions?.reviewResultKind ?? 'local_review';
      const payload: StoredLink = {
        tool_use_id: toolUseId,
        request_id: requestId,
        session_id: sessionId,
        review_result_kind: kind,
      };
      if (putOptions?.needsUserDecisionApprove === true) {
        payload.needs_user_decision_approve = true;
      }

      await mkdir(dirPath, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      try {
        await rename(tempPath, filePath);
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    },

    async getLink(toolUseId: string, sessionId: string): Promise<ToolUseLinkData | null> {
      const link = await readStoredLink(rootDir, sessionId, toolUseId);
      if (!link) {
        return null;
      }
      if (link.session_id !== sessionId) {
        await deleteStoredLink(rootDir, sessionId, toolUseId);
        return null;
      }
      return {
        requestId: link.request_id,
        needsUserDecisionApprove: link.needs_user_decision_approve === true,
        reviewResultKind: link.review_result_kind ?? 'local_review',
      };
    },

    async getRequestId(toolUseId: string, sessionId: string): Promise<string | null> {
      const data = await this.getLink(toolUseId, sessionId);
      return data?.requestId ?? null;
    },

    async markUserDecisionSubmitted(toolUseId: string, sessionId: string): Promise<void> {
      const link = await readStoredLink(rootDir, sessionId, toolUseId);
      if (!link) {
        throw new Error(`markUserDecisionSubmitted: no tool-use link for ${toolUseId}`);
      }
      if (link.session_id !== sessionId) {
        throw new Error(`markUserDecisionSubmitted: session mismatch for ${toolUseId}`);
      }
      const filePath = toolUseLinkFilePath(rootDir, sessionId, toolUseId);
      const dirPath = path.dirname(filePath);
      const tempPath = path.join(dirPath, `${path.basename(filePath)}.${randomUUID()}.tmp`);
      const payload: StoredLink = {
        tool_use_id: toolUseId,
        request_id: link.request_id,
        session_id: sessionId,
        review_result_kind: link.review_result_kind ?? 'local_review',
      };
      await mkdir(dirPath, { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      try {
        await rename(tempPath, filePath);
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    },

    async consumeRequestId(toolUseId: string, sessionId: string): Promise<string | null> {
      const link = await readStoredLink(rootDir, sessionId, toolUseId);
      if (!link) {
        return null;
      }
      if (link.session_id !== sessionId) {
        await deleteStoredLink(rootDir, sessionId, toolUseId);
        return null;
      }
      await deleteStoredLink(rootDir, sessionId, toolUseId);
      return link.request_id;
    },
  };
}

async function readStoredLink(rootDir: string, sessionId: string, toolUseId: string): Promise<StoredLink | null> {
  const filePath = toolUseLinkFilePath(rootDir, sessionId, toolUseId);
  try {
    const raw = await readFile(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`invalid tool-use link file for ${toolUseId}`);
    }
    if (!isStoredLink(parsed, toolUseId)) {
      throw new Error(`invalid tool-use link payload for ${toolUseId}`);
    }
    return parsed;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function deleteStoredLink(rootDir: string, sessionId: string, toolUseId: string): Promise<void> {
  await rm(toolUseLinkFilePath(rootDir, sessionId, toolUseId), { force: true });
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string';
}
