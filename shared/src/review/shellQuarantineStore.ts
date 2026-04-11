/**
 * Tracks repeated shell denials for quarantine (Task 4). In-memory per session/workspace;
 * Task 3 wired hooks; thresholds apply here.
 */

export type ShellDenyKind = 'phase1' | 'resolve' | 'symlink_risk' | 'phase2';

export interface ShellQuarantineKey {
  sessionId: string;
  workspaceRoot: string;
}

export interface ShellQuarantineStore {
  isQuarantined(key: ShellQuarantineKey): boolean;
  recordDeny(key: ShellQuarantineKey, kind: ShellDenyKind): void;
  clearDenyStreak(key: ShellQuarantineKey): void;
}

/** Default thresholds from plan/spec: symlink/realpath denials, consecutive chain, short-window burst. */
export interface ShellQuarantineOptions {
  now?: () => number;
  recentWindowMs?: number;
  maxSymlinkRiskDenies?: number;
  maxConsecutiveDenies?: number;
  maxRecentDeniesInWindow?: number;
}

interface KeyState {
  quarantined: boolean;
  consecutiveDenies: number;
  symlinkRiskDenies: number;
  recentDenyTimestamps: number[];
}

function keyString(key: ShellQuarantineKey): string {
  return `${key.sessionId}\0${key.workspaceRoot}`;
}

function countsTowardSymlinkRisk(kind: ShellDenyKind): boolean {
  return kind === 'symlink_risk' || kind === 'phase2';
}

export function createShellQuarantineStore(options?: ShellQuarantineOptions): ShellQuarantineStore {
  const now = options?.now ?? (() => Date.now());
  const recentWindowMs = options?.recentWindowMs ?? 60_000;
  const maxSymlinkRiskDenies = options?.maxSymlinkRiskDenies ?? 2;
  const maxConsecutiveDenies = options?.maxConsecutiveDenies ?? 3;
  const maxRecentDeniesInWindow = options?.maxRecentDeniesInWindow ?? 5;

  const stateByKey = new Map<string, KeyState>();

  function getState(key: ShellQuarantineKey): KeyState {
    const id = keyString(key);
    let s = stateByKey.get(id);
    if (!s) {
      s = {
        quarantined: false,
        consecutiveDenies: 0,
        symlinkRiskDenies: 0,
        recentDenyTimestamps: [],
      };
      stateByKey.set(id, s);
    }
    return s;
  }

  return {
    isQuarantined(key: ShellQuarantineKey): boolean {
      return getState(key).quarantined;
    },

    recordDeny(key: ShellQuarantineKey, kind: ShellDenyKind): void {
      const s = getState(key);
      if (s.quarantined) {
        return;
      }

      const t = now();
      s.consecutiveDenies += 1;
      if (countsTowardSymlinkRisk(kind)) {
        s.symlinkRiskDenies += 1;
      }
      s.recentDenyTimestamps.push(t);
      const windowStart = t - recentWindowMs;
      s.recentDenyTimestamps = s.recentDenyTimestamps.filter((ts) => ts >= windowStart);

      if (s.symlinkRiskDenies >= maxSymlinkRiskDenies) {
        s.quarantined = true;
        return;
      }
      if (s.consecutiveDenies >= maxConsecutiveDenies) {
        s.quarantined = true;
        return;
      }
      if (s.recentDenyTimestamps.length >= maxRecentDeniesInWindow) {
        s.quarantined = true;
      }
    },

    clearDenyStreak(key: ShellQuarantineKey): void {
      const s = getState(key);
      s.consecutiveDenies = 0;
    },
  };
}
