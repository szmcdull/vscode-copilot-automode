# adapter-vscode

VSCode-compatible extension-host adapter for Auto Mode.

## Install and Use

### What it installs

- An extension running in a VSCode-compatible extension host
- The hook plugin runtime under `~/.auto-mode/vscode-plugin`
- The hook CLI runtime under `~/.auto-mode/hook-cli`

This adapter documents the extension-host path only. Even if Cursor can load much of the same extension surface, that should not be read as full support for Cursor IDE's own agent/tool path.

### Prerequisites

- A VSCode-compatible editor with host plugin support
- Node.js
- `bash`
- npm
- A model API key for either Anthropic-compatible or OpenAI-compatible access

### Install

1. Install dependencies for this adapter:

```bash
cd adapter-vscode
npm install
cd ..
```

2. Run the installer from the repository root:

```bash
npm run install:vscode
```

That installer builds `adapter-vscode`, packages and installs the VSIX, deploys the hook runtime into `~/.auto-mode/`, and safely updates VSCode user settings so the plugin runtime can be discovered.

### Configure model settings

Minimum `settings.json`:

```json
{
  "autoMode.modelProvider": "anthropic",
  "autoMode.modelName": "claude-3-7-sonnet-latest",
  "autoMode.apiKey": "your-api-key"
}
```

OpenAI-compatible example:

```json
{
  "autoMode.modelProvider": "openai",
  "autoMode.modelName": "gpt-4.1",
  "autoMode.apiKey": "your-api-key"
}
```

Optional settings:

- `autoMode.anthropicBaseUrl`
- `autoMode.openaiBaseUrl`
- `autoMode.modelTimeoutMs`

### Start using it

1. Reload the editor window after installation and configuration.
2. Trigger a real AI shell action that uses `run_in_terminal`.
3. Confirm that the hook path returns `allow` / `deny`.

### Quick validation

- Verify the extension activates on startup
- Verify AI terminal actions trigger `PreToolUse`
- Verify safe commands are reviewed instead of silently falling back
- Verify the hook path uses `allow` / `deny`, while the command palette path may still use extension-owned `ask`

### Review behavior

- The mature review target is `run_in_terminal`
- The hook path uses two-phase review: phase 1 extracts likely accesses, then local glob / realpath resolution verifies the actual paths, and phase 2 runs only when resolved paths need extra scrutiny
- On the hook path, the practical result is mainly `allow` / `deny`
- The command palette path is separate and may still use extension-owned `ask`
- Repeated denials can trigger quarantine and block later risky shell attempts earlier

## Development and Debugging

### Local development

From this directory:

```bash
npm run build
npm test
npm run package
```

Useful scripts:

- `npm run watch`
- `npm run devhost:vscode`
- `npm run devhost:cursor`

`npm run devhost:cursor` is for validating the extension-host-compatible surface inside Cursor. It does not imply that Cursor IDE's native agent flow is already modeled as a first-class host path in this repository.

### Live-model verification

```bash
npm run test:live-model
```

This is not part of the default `npm test`. It reads `~/.auto-mode/live-test.json`, requires `"enabled": true`, and supports optional `baseUrl`, `maxCases`, and `debug`.

### Debugging notes

- Full hook behavior still needs live validation in a real editor
- `plugin-vscode-hooks/README.md` is the best starting point for hook-runtime smoke checks
- `AGENTS_DOCS/` contains internal architecture notes and troubleshooting details

## Current Limitations

- The `run_in_terminal` hook path is the most mature line today
- Non-shell categories are still incremental or experimental
