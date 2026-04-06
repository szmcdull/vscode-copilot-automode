# auto-mode

[中文文档](README_cn.md)

auto-mode is an experimental AI auto-review layer for VSCode.

It intercepts hook events before and after AI agent actions, reviews shell commands with a model before execution, and returns host decisions. For the hook `run_in_terminal` path, the extension uses a **two-phase** review (path extraction, local glob/realpath resolution, optional second model pass) plus a **repeated-deny quarantine** that after multiple denials, stops invoking the model for analysis and directly denies all subsequent external command tool requests while alerting the user, preventing deadlocks in looping workflows.

The current shell-review prompt also treats **remote download / fetch** as a hard deny condition, even when execution is split into a later command.

At the moment, the mature product line is automatic review of the `run_in_terminal` tool in the hook flow.

## What This Repository Contains

This repository includes two runtime components that work together:

- `plugin-vscode-hooks/`: a Claude Code format plugin. VSCode now supports the Claude Code plugin ecosystem.
  - A hook plugin discovered by the VSCode host
  - Registered via `chat.pluginLocations` (after `npm run install:vscode`, typically `~/.auto-mode/vscode-plugin`; the directory in this repository is the source tree—see `plugin-vscode-hooks/README.md`)
  - Declares `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`
  - Forwards hook payloads to Node through shell wrappers
- `adapter-vscode/`
  - A VSCode extension running in the extension host
  - Handles the local bridge, review engine, UI, configuration, packaging, and model clients

## How It Works

The hook mainline for `run_in_terminal` is:

1. VSCode discovers the hook plugin (after install, under `~/.auto-mode/vscode-plugin`; the `plugin-vscode-hooks/` folder in this repo is the development copy).
2. The host triggers a hook, for example `PreToolUse`.
3. The plugin executes `./scripts/*.sh`.
4. The shell wrapper calls the hook CLI (`~/.auto-mode/hook-cli/dist/hooks/cli.js` after `npm run install:vscode`; when developing from the repository, `adapter-vscode/dist/hooks/cli.js`).
5. The hook CLI forwards the request to the extension-host bridge.
6. The bridge runs **phase 1** shell review (model proposes path reads/writes/deletes/executes), then a **local resolver** (literal glob expansion, symlink / `realpath` facts). If symlink-resolved paths need extra scrutiny, **phase 2** review runs; otherwise phase 1 alone can suffice.
7. The extension returns `allow` or `deny` to the host for this hook path (no `ask` in the hook flow). Repeated denials can trip **shell quarantine** and deny later terminal tool calls early.

The **Auto Mode: Run Reviewed Shell Command** command palette path is separate: it still uses the legacy single-phase reviewer and may return `ask` with the extension UI.

## Current Scope

Implemented today:

- Real host-side interception for `run_in_terminal` with **two-phase realpath-aware** review on the hook path
- **Repeated-deny shell quarantine** (in-memory, per session/workspace) to block further `run_in_terminal` after risky patterns
- Extension-owned confirmation UI when the **command palette** path returns `ask`
- Direct model access inside the extension host

Current limitations:

- Non-shell categories are still incomplete or experimental
- End-to-end behavior should still be manually validated in a real editor
- The hook launcher is currently mainly aimed at Unix-like environments

## Requirements

- VSCode or Cursor with host plugin support
- Node.js
- `bash`
- npm
- One model API key for either of the following:
  - Anthropic-compatible endpoint
  - OpenAI-compatible endpoint

## Install in VSCode

### 1. Install `adapter-vscode` dependencies

```bash
cd adapter-vscode
npm install
cd ..
```

Install the extension dependencies from `adapter-vscode/`, then return to the **repository root** for the one-command installer.

### 2. Build, package, install the extension, and deploy the hook runtime

```bash
npm run install:vscode
```

Still at the **repository root**, this runs `scripts/install-vscode.sh`, which:

- Builds `adapter-vscode`
- Packages the VSIX to `.artifacts/auto-mode.vsix`
- Installs that VSIX into VS Code (you do **not** need to run `code --install-extension` manually)
- Materializes the hook plugin under `~/.auto-mode/vscode-plugin`
- Deploys the hook CLI under `~/.auto-mode/hook-cli` (entrypoint `~/.auto-mode/hook-cli/dist/hooks/cli.js`)
- Safely merges your VS Code **User** `settings.json` so `chat.pluginLocations` points at `~/.auto-mode/vscode-plugin`
- Fills in `chat.plugins.enabled: true` only when that setting is currently missing

If you have explicitly disabled host plugins with `chat.plugins.enabled: false`, the installer preserves that choice. In that case, turn host plugins back on yourself before expecting the hook runtime to load.

You do **not** need to hand-edit `chat.pluginLocations` for this install path.

Migration note: if you previously followed older docs and manually pointed `chat.pluginLocations` at the repo-local `plugin-vscode-hooks` directory, the installer preserves that old entry and appends `~/.auto-mode/vscode-plugin`. After you migrate to the installed runtime, remove the old repo-local entry to avoid confusion from having two plugin sources listed at once.

### 3. Configure Auto Mode Extension Settings

The minimum required `settings.json`:

```json
{
  "autoMode.modelProvider": "anthropic",
  "autoMode.modelName": "claude-3-7-sonnet-latest",
  "autoMode.apiKey": "your-api-key"
}
```

If you use an OpenAI-compatible gateway, configure it like this:

```json
{
  "autoMode.modelProvider": "openai",
  "autoMode.modelName": "gpt-4.1",
  "autoMode.apiKey": "your-api-key"
}
```

Optional settings include:

- `autoMode.anthropicBaseUrl`
- `autoMode.openaiBaseUrl`
- `autoMode.modelTimeoutMs`

### 4. Restart or Reload VSCode

After installing the extension and updating settings, reload the window to ensure both the extension and plugin are active.

## Quick Validation

After installation, check the following first:

1. Whether the extension is activated successfully on startup
2. Whether real AI terminal actions trigger `PreToolUse`
3. Whether safe commands are reviewed instead of unexpectedly falling back to host default approval
4. For **hook** `run_in_terminal`: decisions are `allow` / `deny` (no extension `ask` dialog). For the **command palette** reviewed shell command, `ask` may still use the extension-owned confirmation UI
5. If a command is denied and the agent retries with the **same command text**, a **new** `tool_use_id` means a **new** review round—not a duplicate of the same hook invocation
6. Commands whose primary effect is downloading or fetching remote content should currently be denied by the review prompt, even when execution would happen in a later step

For more detailed validation steps, see:

- `plugin-vscode-hooks/README.md`
- `AGENTS_DOCS/` for implementation notes and development details

## Development

TypeScript part:

```bash
cd adapter-vscode
npm test
npm run build
```

To validate prompt behavior against a real provider instead of mocks/stubs:

```bash
cd adapter-vscode
npm run test:live-model
```

Live-model smoke tests are **not** part of the default `npm test` run. They read `~/.auto-mode/live-test.json`, require `"enabled": true`, and accept optional `baseUrl`, `maxCases`, and `debug` fields. Environment variables still override file values; `AUTO_MODE_LIVE_DEBUG=1` prints the request and raw response with auth headers redacted.

## Repository Structure

- `adapter-vscode/` - VSCode extension, hook bridge, review engine, UI
- `plugin-vscode-hooks/` - host hook plugin manifest and shell wrappers
- `docs/protocol/` - protocol and integration docs
- `fixtures/` - sample payloads, policies, and decision fixtures
- `AGENTS_DOCS/` - implementation lessons and supplemental notes

## Limitations

- The most mature line today is the `run_in_terminal` hook flow (two-phase review + quarantine); the command palette shell entry is a different, legacy path
- Other tool categories are not at the same maturity level yet
- Automated tests cannot replace live validation in a real editor
- The host hook ecosystem is still evolving, and behavior can vary by host version

## License

This repository is licensed under the GNU Affero General Public License v3.0. See `LICENSE` for details.
