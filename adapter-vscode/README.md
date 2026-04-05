# adapter-vscode

VSCode/Cursor extension for **Auto Mode**. The current product mainline is **pure TypeScript inside this adapter**: extension-host bridge, review engine, extension-owned `ask` UI, and **direct HTTP calls to the configured model provider**.

## Architecture

- **`plugin-vscode-hooks/`** is the real host interception path for `run_in_terminal`: VSCode runs the hook CLI (`dist/hooks/cli.js`) for `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`.
- With the extension activated, the hook CLI discovers a **workspace-scoped bridge manifest** and forwards events to an **extension-host HTTP server on localhost**.
- **Review model:** configured via extension settings (`autoMode.modelProvider`, `autoMode.modelName`, `autoMode.apiKey`, ...). The extension calls the provider **directly** (for example Anthropic Messages API or OpenAI Chat Completions).
- **Host-facing decisions** for hooks are only **`allow` / `deny` / `ask`**. Internal review may use **`allow_with_constraints`**; the engine contracts that to **`allow`**, **`deny`**, or **`ask`** before returning toward the host.
- **No review-service fallback:** if the bridge manifest is missing or the bridge is unavailable, the hook CLI now fails explicitly instead of falling back to env-based HTTP review.

## What works now

- Extension activation and **hook bridge** startup (requires model settings).
- Workspace-scoped **bridge manifest** for hook CLI discovery.
- **PreToolUse** for `run_in_terminal`: review engine + extension UI for `ask`.
- Palette command **`Auto Mode: Run Reviewed Shell Command`** using the same local TypeScript review path.

## Extension settings

| Setting | Purpose |
|--------|---------|
| `autoMode.modelProvider` | `anthropic` or `openai`. |
| `autoMode.modelName` | Provider-specific model id (default `claude-3-7-sonnet-latest`; for OpenAI you might use `gpt-4.1`). |
| `autoMode.apiKey` | Provider API key (required; empty default in package metadata). |
| `autoMode.anthropicBaseUrl` | Optional override for the Anthropic Messages API base URL. |
| `autoMode.openaiBaseUrl` | Optional override for the OpenAI Chat Completions API base URL. |
| `autoMode.modelTimeoutMs` | Request timeout (default `120000` ms). |

## Local development

From this directory:

```bash
npm install
npm run build
npm test
npm run package
```

Useful scripts: `npm run watch`, `npm run devhost:vscode`, `npm run devhost:cursor`. See `.vscode/launch.json` for debugging.

## Minimal usage path

1. Set **model** settings (`autoMode.apiKey` at minimum; adjust `autoMode.modelName` if needed).
2. For **hooks**, configure the hook plugin (`plugin-vscode-hooks/`) per its README, build this package so `dist/hooks/cli.js` exists, and run the editor with the extension so the bridge manifest is written.

## Packaging and install

```bash
npm run package
```

Install the generated `.vsix` with `code --install-extension …` or `cursor --install-extension …`.

## Current limitations

- Only the hook and palette shell paths are fully wired for end-to-end experimentation; other categories remain incremental.
- **Automated tests** cover TypeScript units and builds; **full VSCode UI and live hook behavior** still require the manual smoke checklist in `plugin-vscode-hooks/README.md`.
