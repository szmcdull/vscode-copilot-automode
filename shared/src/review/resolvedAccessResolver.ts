import path from 'node:path';
import { access, glob as fsGlob, lstat, realpath as fsRealpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Phase1Access, Phase2ResolvedAccess } from './reviewPrompt.js';

export interface LstatNoFollowResult {
  exists: boolean;
  danglingSymlink: boolean;
  kind: 'file' | 'dir' | 'symlink' | 'missing';
  resolvedKind: 'file' | 'dir' | 'missing';
}

export interface ResolvedAccessFs {
  pathExists(p: string): Promise<boolean>;
  realpath(p: string): Promise<string>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  lstatNoFollow(p: string): Promise<LstatNoFollowResult>;
}

export interface ResolvePhase1AccessesResult {
  ok: boolean;
  needsPhase2: boolean;
  accesses: Phase2ResolvedAccess[];
  reason?: string;
}

export interface ResolvePhase1AccessesInput {
  cwd: string;
  accesses: Phase1Access[];
  fs?: ResolvedAccessFs;
}

function pathsDiffer(normExpanded: string, real: string): boolean {
  return path.normalize(normExpanded) !== path.normalize(real);
}

async function resolveExpandedToReal(
  fs: ResolvedAccessFs,
  normExpanded: string,
): Promise<
  | { ok: true; real: string; symlink: 'y' | 'n'; real_from: 'target' | 'parent' }
  | { ok: false; reason: string }
> {
  const targetEntry = await fs.lstatNoFollow(normExpanded);
  if (targetEntry.danglingSymlink) {
    return { ok: false, reason: 'dangling symlink target' };
  }

  if (await fs.pathExists(normExpanded)) {
    try {
      const real = await fs.realpath(normExpanded);
      const symlink = pathsDiffer(normExpanded, real) ? 'y' : 'n';
      return { ok: true, real, symlink, real_from: 'target' };
    } catch {
      return { ok: false, reason: 'target realpath failed' };
    }
  }

  let p = path.dirname(normExpanded);
  for (;;) {
    const parent = path.dirname(p);
    const entry = await fs.lstatNoFollow(p);
    if (entry.danglingSymlink) {
      return { ok: false, reason: 'dangling symlink segment' };
    }
    if (await fs.pathExists(p)) {
      const isDirectoryAnchor =
        entry.kind === 'dir' || (entry.kind === 'symlink' && entry.resolvedKind === 'dir');
      if (!isDirectoryAnchor) {
        return { ok: false, reason: 'existing parent is not a directory' };
      }
      try {
        const realParent = await fs.realpath(p);
        const suffix = path.relative(p, normExpanded);
        const real =
          suffix === '' || suffix === '.'
            ? realParent
            : path.normalize(path.join(realParent, suffix));
        const symlink = pathsDiffer(normExpanded, real) ? 'y' : 'n';
        return { ok: true, real, symlink, real_from: 'parent' };
      } catch {
        return { ok: false, reason: 'parent realpath failed' };
      }
    }
    if (parent === p) {
      return { ok: false, reason: 'no existing parent' };
    }
    p = parent;
  }
}

export async function resolvePhase1Accesses({
  cwd,
  accesses,
  fs = createNodeResolvedAccessFs(),
}: ResolvePhase1AccessesInput): Promise<ResolvePhase1AccessesResult> {
  const out: Phase2ResolvedAccess[] = [];

  for (const accessItem of accesses) {
    let expandedPaths: string[];
    if (accessItem.glob) {
      try {
        expandedPaths = await fs.glob(accessItem.path, cwd);
      } catch {
        return { ok: false, needsPhase2: false, accesses: [], reason: 'glob expansion failed' };
      }
      if (expandedPaths.length === 0) {
        return { ok: false, needsPhase2: false, accesses: [], reason: 'glob matched nothing' };
      }
    } else {
      expandedPaths = [path.resolve(cwd, accessItem.path)];
    }

    for (const expandedRaw of expandedPaths) {
      const normExpanded = path.normalize(expandedRaw);
      const resolved = await resolveExpandedToReal(fs, normExpanded);
      if (!resolved.ok) {
        return { ok: false, needsPhase2: false, accesses: [], reason: resolved.reason };
      }
      out.push({
        kind: accessItem.kind,
        path: accessItem.path,
        expanded: normExpanded,
        real: resolved.real,
        symlink: resolved.symlink,
        real_from: resolved.real_from,
      });
    }
  }

  const needsPhase2 = out.some((a) => a.symlink === 'y');
  return { ok: true, needsPhase2, accesses: out };
}

export function createNodeResolvedAccessFs(): ResolvedAccessFs {
  return {
    async pathExists(p: string): Promise<boolean> {
      try {
        await access(p, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    realpath: fsRealpath,
    async glob(pattern: string, cwd: string): Promise<string[]> {
      const results: string[] = [];
      for await (const entry of fsGlob(pattern, { cwd })) {
        results.push(path.resolve(cwd, String(entry)));
      }
      return results;
    },
    async lstatNoFollow(p: string): Promise<LstatNoFollowResult> {
      try {
        const stats = await lstat(p);
        if (!stats.isSymbolicLink()) {
          return {
            exists: true,
            danglingSymlink: false,
            kind: stats.isDirectory() ? 'dir' : 'file',
            resolvedKind: stats.isDirectory() ? 'dir' : 'file',
          };
        }
        try {
          await fsRealpath(p);
          const resolvedStats = await stat(p);
          return {
            exists: true,
            danglingSymlink: false,
            kind: 'symlink',
            resolvedKind: resolvedStats.isDirectory() ? 'dir' : 'file',
          };
        } catch {
          return { exists: true, danglingSymlink: true, kind: 'symlink', resolvedKind: 'missing' };
        }
      } catch {
        return { exists: false, danglingSymlink: false, kind: 'missing', resolvedKind: 'missing' };
      }
    },
  };
}
