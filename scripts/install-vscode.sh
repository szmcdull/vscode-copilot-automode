#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ADAPTER_ROOT="${REPO_ROOT}/adapter-vscode"

export REPO_ROOT

cd "${ADAPTER_ROOT}"
npm run build
npm run package
node "${ADAPTER_ROOT}/dist/install/cli.js"
