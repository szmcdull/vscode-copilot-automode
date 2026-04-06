import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Phase1Access } from './reviewPrompt.js';
import { resolvePhase1Accesses, type ResolvedAccessFs } from './resolvedAccessResolver.js';

function makeFs(
  partial: Partial<ResolvedAccessFs> &
    Pick<ResolvedAccessFs, 'pathExists' | 'realpath' | 'lstatNoFollow'>,
): ResolvedAccessFs {
  return {
    glob: vi.fn().mockRejectedValue(new Error('glob not mocked')),
    lstatNoFollow: vi.fn(
      async () => ({ exists: false, danglingSymlink: false, kind: 'missing', resolvedKind: 'missing' }),
    ),
    ...partial,
  };
}

describe('resolvePhase1Accesses', () => {
  it('resolves an existing target without symlinks (symlink n, real_from target)', async () => {
    const expanded = path.resolve('/workspace', 'README.md');
    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === expanded),
      realpath: vi.fn(async (p: string) => p),
    });

    const accesses: Phase1Access[] = [{ kind: 'r', path: 'README.md', glob: false }];
    const result = await resolvePhase1Accesses({ cwd: '/workspace', accesses, fs });

    expect(result.ok).toBe(true);
    expect(result.needsPhase2).toBe(false);
    expect(result.accesses).toHaveLength(1);
    expect(result.accesses[0]).toEqual({
      kind: 'r',
      path: 'README.md',
      expanded,
      real: expanded,
      symlink: 'n',
      real_from: 'target',
    });
  });

  it('uses parent realpath for a new write path and marks symlink y when expanded differs from real', async () => {
    const cwd = '/tmp/proj';
    const raw = 'out/new-file.txt';
    const expanded = path.resolve(cwd, raw);
    const anchor = path.resolve(cwd, 'out');
    const realParent = '/real-vol/proj/out';

    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === anchor),
      realpath: vi.fn(async (p: string) => (p === anchor ? realParent : p)),
      lstatNoFollow: vi.fn(async (p: string) => ({
        exists: p === anchor,
        danglingSymlink: false,
        kind: p === anchor ? 'dir' : 'missing',
        resolvedKind: p === anchor ? 'dir' : 'missing',
      })),
    });

    const accesses: Phase1Access[] = [{ kind: 'w', path: raw, glob: false }];
    const result = await resolvePhase1Accesses({ cwd, accesses, fs });

    expect(result.ok).toBe(true);
    expect(result.needsPhase2).toBe(true);
    expect(result.accesses[0]).toMatchObject({
      kind: 'w',
      path: raw,
      expanded,
      real: path.join(realParent, 'new-file.txt'),
      symlink: 'y',
      real_from: 'parent',
    });
  });

  it('returns ok false when realpath fails', async () => {
    const expanded = path.resolve('/workspace', 'x');
    const fs = makeFs({
      pathExists: vi.fn(async () => true),
      realpath: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    });

    const result = await resolvePhase1Accesses({
      cwd: '/workspace',
      accesses: [{ kind: 'r', path: 'x', glob: false }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });

  it('returns ok false when glob expansion fails', async () => {
    const fs = makeFs({
      pathExists: vi.fn(async () => false),
      realpath: vi.fn(async (p: string) => p),
      glob: vi.fn(async () => {
        throw new Error('glob failed');
      }),
    });

    const result = await resolvePhase1Accesses({
      cwd: '/workspace',
      accesses: [{ kind: 'r', path: '*.missing', glob: true }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });

  it('returns ok false when glob matches nothing', async () => {
    const fs = makeFs({
      pathExists: vi.fn(async () => false),
      realpath: vi.fn(async (p: string) => p),
      glob: vi.fn(async () => []),
      lstatNoFollow: vi.fn(
        async () => ({ exists: false, danglingSymlink: false, kind: 'missing', resolvedKind: 'missing' }),
      ),
    });

    const result = await resolvePhase1Accesses({
      cwd: '/workspace',
      accesses: [{ kind: 'r', path: '*.missing', glob: true }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });

  it('returns ok false when no existing parent can be found', async () => {
    const fs = makeFs({
      pathExists: vi.fn(async () => false),
      realpath: vi.fn(async (p: string) => p),
      lstatNoFollow: vi.fn(
        async () => ({ exists: false, danglingSymlink: false, kind: 'missing', resolvedKind: 'missing' }),
      ),
    });

    const result = await resolvePhase1Accesses({
      cwd: 'relative-cwd',
      accesses: [{ kind: 'w', path: 'new/file.txt', glob: false }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });

  it('marks symlink y with real_from target when the target itself resolves through a symlink', async () => {
    const expanded = path.resolve('/workspace', 'linked.txt');
    const real = '/real/workspace/linked.txt';
    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === expanded),
      realpath: vi.fn(async () => real),
      lstatNoFollow: vi.fn(
        async () => ({ exists: true, danglingSymlink: false, kind: 'symlink', resolvedKind: 'file' }),
      ),
    });

    const result = await resolvePhase1Accesses({
      cwd: '/workspace',
      accesses: [{ kind: 'r', path: 'linked.txt', glob: false }],
      fs,
    });

    expect(result.ok).toBe(true);
    expect(result.needsPhase2).toBe(true);
    expect(result.accesses).toEqual([
      {
        kind: 'r',
        path: 'linked.txt',
        expanded,
        real,
        symlink: 'y',
        real_from: 'target',
      },
    ]);
  });

  it('allows an existing parent that is a valid directory symlink', async () => {
    const cwd = '/workspace';
    const raw = 'linked-dir/new-file.txt';
    const expanded = path.resolve(cwd, raw);
    const anchor = path.resolve(cwd, 'linked-dir');
    const realParent = '/real/workspace/linked-dir';
    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === anchor),
      realpath: vi.fn(async (p: string) => (p === anchor ? realParent : p)),
      lstatNoFollow: vi.fn(async (p: string) => ({
        exists: p === anchor,
        danglingSymlink: false,
        kind: p === anchor ? 'symlink' : 'missing',
        resolvedKind: p === anchor ? 'dir' : 'missing',
      })),
    });

    const result = await resolvePhase1Accesses({
      cwd,
      accesses: [{ kind: 'w', path: raw, glob: false }],
      fs,
    });

    expect(result.ok).toBe(true);
    expect(result.needsPhase2).toBe(true);
    expect(result.accesses).toEqual([
      {
        kind: 'w',
        path: raw,
        expanded,
        real: path.join(realParent, 'new-file.txt'),
        symlink: 'y',
        real_from: 'parent',
      },
    ]);
  });

  it('returns ok false when a missing segment is a dangling symlink', async () => {
    const cwd = '/workspace';
    const raw = 'dangling/file.txt';
    const expanded = path.resolve(cwd, raw);
    const dangling = path.resolve(cwd, 'dangling');

    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === cwd),
      realpath: vi.fn(async (p: string) => p),
      lstatNoFollow: vi.fn(async (p: string) => ({
        exists: p === dangling,
        danglingSymlink: p === dangling,
        kind: p === dangling ? 'symlink' : 'missing',
        resolvedKind: p === dangling ? 'missing' : 'missing',
      })),
    });

    const result = await resolvePhase1Accesses({
      cwd,
      accesses: [{ kind: 'w', path: raw, glob: false }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });

  it('returns ok false when the target itself is a dangling symlink', async () => {
    const expanded = path.resolve('/workspace', 'dangling-target');
    const fs = makeFs({
      pathExists: vi.fn(async () => false),
      realpath: vi.fn(async (p: string) => p),
      lstatNoFollow: vi.fn(async (p: string) => ({
        exists: p === expanded,
        danglingSymlink: p === expanded,
        kind: p === expanded ? 'symlink' : 'missing',
        resolvedKind: p === expanded ? 'missing' : 'missing',
      })),
    });

    const result = await resolvePhase1Accesses({
      cwd: '/workspace',
      accesses: [{ kind: 'r', path: 'dangling-target', glob: false }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('dangling');
    expect(result.accesses).toEqual([]);
  });

  it('returns ok false when the first existing ancestor is a file', async () => {
    const cwd = '/workspace';
    const fileAncestor = path.resolve(cwd, 'artifact.txt');
    const fs = makeFs({
      pathExists: vi.fn(async (p: string) => p === fileAncestor),
      realpath: vi.fn(async (p: string) => p),
      lstatNoFollow: vi.fn(async (p: string) => ({
        exists: p === fileAncestor,
        danglingSymlink: false,
        kind: p === fileAncestor ? 'file' : 'missing',
        resolvedKind: p === fileAncestor ? 'file' : 'missing',
      })),
    });

    const result = await resolvePhase1Accesses({
      cwd,
      accesses: [{ kind: 'w', path: 'artifact.txt/child.txt', glob: false }],
      fs,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.accesses).toEqual([]);
  });
});
