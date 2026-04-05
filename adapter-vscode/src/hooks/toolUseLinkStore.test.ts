import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createToolUseLinkStore } from './toolUseLinkStore.js';

const testRoot = path.join('/tmp', 'auto-mode-tool-use-links-test', `run-${process.pid}`);

describe('tool use link store', () => {
  afterAll(async () => {
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('stores and resolves request id by tool_use_id', async () => {
    await mkdir(testRoot, { recursive: true });
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('tool-abc', 'req-xyz', 'sess-1');

    await expect(store.consumeRequestId('tool-abc', 'sess-1')).resolves.toBe('req-xyz');
    await expect(store.consumeRequestId('tool-abc', 'sess-1')).resolves.toBeNull();
  });

  it('returns null for unknown tool_use_id', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });
    await expect(store.consumeRequestId('missing-tool', 'sess-1')).resolves.toBeNull();
  });

  it('returns null for wrong session_id without affecting another session link for same tool_use_id', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('tool-stale', 'req-stale', 'sess-old');

    await expect(store.consumeRequestId('tool-stale', 'sess-new')).resolves.toBeNull();
    await expect(store.consumeRequestId('tool-stale', 'sess-old')).resolves.toBe('req-stale');
    await expect(store.consumeRequestId('tool-stale', 'sess-old')).resolves.toBeNull();
  });

  it('isolates same tool_use_id across concurrent sessions on one runtime root', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('shared-tool-id', 'req-a', 'session-a');
    await store.put('shared-tool-id', 'req-b', 'session-b');

    await expect(store.consumeRequestId('shared-tool-id', 'session-a')).resolves.toBe('req-a');
    await expect(store.consumeRequestId('shared-tool-id', 'session-b')).resolves.toBe('req-b');
    await expect(store.consumeRequestId('shared-tool-id', 'session-a')).resolves.toBeNull();
    await expect(store.consumeRequestId('shared-tool-id', 'session-b')).resolves.toBeNull();
  });

  it('persists needs_user_decision_approve for ask_pending flows', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('tool-ask', 'req-ask', 'sess-1', { needsUserDecisionApprove: true });

    await expect(store.getLink('tool-ask', 'sess-1')).resolves.toEqual({
      requestId: 'req-ask',
      needsUserDecisionApprove: true,
      reviewResultKind: 'local_review',
    });
    await expect(store.consumeRequestId('tool-ask', 'sess-1')).resolves.toBe('req-ask');
  });

  it('defaults needsUserDecisionApprove to false when field omitted in file', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('tool-legacy', 'req-legacy', 'sess-1');

    await expect(store.getLink('tool-legacy', 'sess-1')).resolves.toEqual({
      requestId: 'req-legacy',
      needsUserDecisionApprove: false,
      reviewResultKind: 'local_review',
    });
  });

  it('markUserDecisionSubmitted clears needsUserDecisionApprove for retries', async () => {
    const store = createToolUseLinkStore({ rootDir: testRoot });

    await store.put('tool-mark', 'req-mark', 'sess-1', { needsUserDecisionApprove: true });
    await expect(store.getLink('tool-mark', 'sess-1')).resolves.toEqual({
      requestId: 'req-mark',
      needsUserDecisionApprove: true,
      reviewResultKind: 'local_review',
    });

    await store.markUserDecisionSubmitted('tool-mark', 'sess-1');
    await expect(store.getLink('tool-mark', 'sess-1')).resolves.toEqual({
      requestId: 'req-mark',
      needsUserDecisionApprove: false,
      reviewResultKind: 'local_review',
    });
    await expect(store.consumeRequestId('tool-mark', 'sess-1')).resolves.toBe('req-mark');
  });
});
