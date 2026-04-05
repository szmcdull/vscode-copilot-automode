#!/usr/bin/env bash
set -euo pipefail

# Resolve plugin root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Sibling package in the worktree
ADAPTER_ROOT="$(cd "${PLUGIN_ROOT}/../adapter-vscode" && pwd)"

HOOK_CLI_JS="${ADAPTER_ROOT}/dist/hooks/cli.js"

if [[ ! -f "${HOOK_CLI_JS}" ]]; then
  printf '%s\n' "hook CLI not built: expected ${HOOK_CLI_JS}. Run 'npm run build' in ${ADAPTER_ROOT} first." >&2
  exit 1
fi

exec node "${HOOK_CLI_JS}" "$@"
