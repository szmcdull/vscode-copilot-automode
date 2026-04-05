# auto-mode

auto-mode is an experimental AI auto-review layer for VSCode.

It intercepts hook events before and after AI agent actions, reviews commands with a model before execution, and then returns `allow` / `ask` / `deny`.

At the moment, it primarily focuses on automatically reviewing the `run_in_terminal` tool to improve workflow automation.

## What This Repository Contains

This repository includes two runtime components that work together:

- `plugin-vscode-hooks/`: a Claude Code format plugin. VSCode now supports the Claude Code plugin ecosystem.
  - A hook plugin discovered by the VSCode host
  - Registered via `chat.pluginLocations`
  - Declares `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`
  - Forwards hook payloads to Node through shell wrappers
- `adapter-vscode/`
  - A VSCode extension running in the extension host
  - Handles the local bridge, review engine, UI, configuration, packaging, and model clients

## How It Works

The main path is:

1. VSCode discovers `plugin-vscode-hooks/`.
2. The host triggers a hook, for example `PreToolUse`.
3. The plugin executes `./scripts/*.sh`.
4. The shell wrapper calls `adapter-vscode/dist/hooks/cli.js`.
5. The hook CLI forwards the request to the extension-host bridge.
6. The TypeScript review engine directly calls your configured model.
7. The extension returns `allow`, `ask`, or `deny`.

## Current Scope

Implemented today:

- Real host-side interception for `run_in_terminal`
- Extension-owned confirmation UI when decision is `ask`
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

### 1. Build and Package the Extension

```bash
cd adapter-vscode
npm install
npm run build
npm run package
```

After running these commands, a `.vsix` package is generated under `adapter-vscode/`.

### 2. Install the Extension

If you install from command line at the repository root:

```bash
code --install-extension ./adapter-vscode/auto-mode-*.vsix
```

You can also install the generated `.vsix` manually from the VSCode Extensions panel.

### 3. Register the Hook Plugin in VSCode User Settings

Add the following to **User Settings**:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/to/auto-mode/plugin-vscode-hooks": true
  }
}
```

Notes:

- Use the absolute path of your local `plugin-vscode-hooks` directory
- This must be placed in **user settings**; workspace settings will not take effect

### 4. Configure Auto Mode Extension Settings

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

### 5. Restart or Reload VSCode

After installing the extension and updating settings, reload the window to ensure both the extension and plugin are active.

## Quick Validation

After installation, check the following first:

1. Whether the extension is activated successfully on startup
2. Whether real AI terminal actions trigger `PreToolUse`
3. Whether safe commands are reviewed instead of unexpectedly falling back to host default approval
4. Whether `ask` uses the extension-owned confirmation UI

For more detailed validation steps, see:

- `plugin-vscode-hooks/README.md`
- `adapter-vscode/README.md`

## Development

TypeScript part:

```bash
cd adapter-vscode
npm test
npm run build
```

## Repository Structure

- `adapter-vscode/` - VSCode extension, hook bridge, review engine, UI
- `plugin-vscode-hooks/` - host hook plugin manifest and shell wrappers
- `docs/protocol/` - protocol and integration docs
- `fixtures/` - sample payloads, policies, and decision fixtures
- `AGENTS_DOCS/` - implementation lessons and supplemental notes

## Limitations

- The most mature line today is the `run_in_terminal` hook flow; other categories are not at the same maturity level yet
- Automated tests cannot replace live validation in a real editor
- The host hook ecosystem is still evolving, and behavior can vary by host version

## License

This repository is licensed under the GNU Affero General Public License v3.0. See `LICENSE` for details.
