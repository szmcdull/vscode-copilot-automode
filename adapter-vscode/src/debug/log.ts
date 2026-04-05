import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface DebugLogEntry {
  component: string;
  event: string;
  details?: Record<string, unknown>;
}

export function debugLogPathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AUTO_MODE_DEBUG_LOG?.trim();
  return configured && configured.length > 0
    ? configured
    : path.join(tmpdir(), 'auto-mode-debug.log');
}

export async function appendDebugLog(
  entry: DebugLogEntry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const logPath = debugLogPathFromEnv(env);
  await mkdir(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  await appendFile(logPath, `${line}\n`, 'utf8');
}

export function summarizeHookPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    return { payloadType: typeof payload };
  }

  const record = payload as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
    session_id: typeof record.session_id === 'string' ? record.session_id : undefined,
    tool_name: typeof record.tool_name === 'string' ? record.tool_name : undefined,
    tool_use_id: typeof record.tool_use_id === 'string' ? record.tool_use_id : undefined,
  };
}
