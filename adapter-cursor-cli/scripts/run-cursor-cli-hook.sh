#!/usr/bin/env bash
# Cursor CLI hook entry. Keeps stdin intact for the Node adapter.
# If the adapter dist is missing, fail-open allow so local builds are not deadlocked.
set -euo pipefail
event="${1:?usage: run-cursor-cli-hook.sh <beforeShellExecution|preToolUse>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
exe="$root/adapter-cursor-cli/dist/adapter-cursor-cli/src/hookEntry.js"
if [[ "${AUTO_MODE_SKIP_CURSOR_HOOK:-}" == "1" ]]; then
  echo '{"permission":"allow","agentMessage":"Auto Mode Cursor CLI adapter: skipped by AUTO_MODE_SKIP_CURSOR_HOOK=1."}'
  exit 0
fi
if [[ ! -f "$exe" ]]; then
  echo '{"permission":"allow","agentMessage":"Auto Mode Cursor CLI adapter: run npm run build --prefix adapter-cursor-cli first. Falling back to allow so builds are not blocked."}'
  exit 0
fi

# Keep local development usable: if review mode was explicitly enabled but the
# minimum model config is missing, downgrade this wrapper invocation to dry-run.
if [[ "${AUTO_MODE_CURSOR_CLI_MODE:-}" == "review" ]]; then
  if [[ -z "${AUTO_MODE_API_KEY:-}" || -z "${AUTO_MODE_MODEL_NAME:-}" ]]; then
    export AUTO_MODE_CURSOR_CLI_MODE="dry-run"
  fi
fi
exec node "$exe" "$event"
