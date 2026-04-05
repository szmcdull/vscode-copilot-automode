# plugin-vscode-hooks

Hook plugin for VSCode/Cursor that wires host hook events (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`) to the Node hook runner in `adapter-vscode`.

## Repository copy vs installed runtime

The `plugin-vscode-hooks/` directory in this repository is the **source / development** tree. After you install dependencies in **`adapter-vscode/`** and then run **`npm run install:vscode`** from the **repository root**, the installer copies the plugin material that VS Code actually loads into **`~/.auto-mode/vscode-plugin`**. Day-to-day, assume the host is using that path unless you are explicitly developing against the in-repo copy.

This package is the **real host path** for intercepting **`run_in_terminal`** in VSCode. Installing only the extension and using the palette command **`Auto Mode: Run Reviewed Shell Command`** exercises a **different** entry (adapter-centric); the **hook-driven flow** is what ties prompt storage, terminal tool use, and post-execution hooks together.

## Contract (hooks vs extension)

| Topic | Value |
|-------|--------|
| Real shell tool name in hooks | `run_in_terminal` |
| Payload field names | **snake_case** (e.g. `session_id`, `tool_use_id`, `tool_input`) |
| **Product mainline (hooks)** | **Pure TypeScript in the extension host**: hook CLI forwards to a **localhost bridge** when a workspace manifest exists; **PreToolUse** review uses the extension’s **direct model HTTP client** (not Copilot and not VS Code Language Model API). |
| **Fallback (no bridge)** | No legacy HTTP review-service fallback remains. If the bridge manifest is missing, the CLI fails clearly and asks you to start the extension for that workspace. |
| Host-visible permission outcome | **`allow` / `deny` / `ask`** only. **`ask`** is intended to be resolved with **extension-owned UI** after bridge handling, not as the long-term “host ask” design. |
| `allow_with_constraints` | **Internal** to the review engine only; it must **contract** to `allow`, `deny`, or `ask` before any host-facing result. |

## VSCode User Settings (installed vs local development)

**Recommended install path:** first run `cd adapter-vscode && npm install && cd ..`, then run `npm run install:vscode` from the repository root. The installer **safely merges** your VS Code **User** `settings.json` so `chat.pluginLocations` includes `~/.auto-mode/vscode-plugin` (the runtime copy created by the install). You do not need to edit `chat.pluginLocations` by hand for that flow.

If you previously followed older docs and manually pointed `chat.pluginLocations` at the repo-local `plugin-vscode-hooks` directory, the installer preserves that old entry and appends `~/.auto-mode/vscode-plugin`. After you migrate to the installed runtime, remove the old repo-local entry so you do not keep two plugin sources side by side.

**Local development against the in-repo plugin:** discovery still typically requires **User** settings (not only workspace settings), pointing at this directory, for example:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/to/auto-mode/plugin-vscode-hooks": true
  }
}
```

Use the absolute path to **this** directory on your machine. Without `chat.pluginLocations` pointing at this directory, VSCode will not load this plugin when you are developing from the repository.

**Extension settings for the bridge + model path** (required for the pure-TS hook mainline): set at least `autoMode.apiKey`, then choose `autoMode.modelProvider` (`anthropic` or `openai`) and a matching `autoMode.modelName`; optionally set `autoMode.anthropicBaseUrl` or `autoMode.openaiBaseUrl` if you use a compatible gateway. Hook subprocesses do not automatically inherit all `autoMode.*` values; the **bridge** runs inside the extension host and uses those settings.

## Runtime assumptions

This entry path currently depends on:

- `bash` to run `scripts/run-hook.sh`
- `node` to execute the built CLI

Current status: this setup is aimed at Unix-like development environments. It is not yet presented as a finished cross-platform launcher.

### Hook CLI behavior

Installed runtime: after `npm run install:vscode`, hooks invoke **`~/.auto-mode/hook-cli/dist/hooks/cli.js`** as a **child process**.

Development-only / repo-local path: when you are developing directly from this repository without that install step, the comparable CLI path is `adapter-vscode/dist/hooks/cli.js` in the repo-local development tree.

In both cases, the CLI expects the extension to have published a **workspace bridge manifest**. When the manifest is missing, it now fails explicitly instead of attempting any env-based HTTP review fallback.

## Hook runner (Node, development-only / repo-local)

Build the adapter TypeScript so the hook CLI exists:

```bash
cd ../adapter-vscode
npm install
npm run build
```

Emitted entrypoint (development-only / repo-local): `adapter-vscode/dist/hooks/cli.js`

The first positional argument is the hook event name; the JSON payload is read from **stdin**. The process writes one JSON line to stdout (the hook response).

## Shell wrapper (development-only / repo-local)

This section describes the **repository-local development layout**, not the installed runtime under `~/.auto-mode/`.

In the repo-local layout, `scripts/run-hook.sh` uses `exec node` so **stdin is passed through** to the Node process unchanged. The hook manifest uses repo-relative script entries (`./scripts/*.sh`) in this development-only tree, and each wrapper script resolves the CLI path relative to this plugin directory: sibling `../adapter-vscode/dist/hooks/cli.js` in the same repo-local development layout.

If that built file is missing, the script exits early with a clear error telling you to run `npm run build` in `adapter-vscode/`.

## Automated verification (TypeScript only)

From `adapter-vscode/`:

```bash
npm test
npm run build
```

These commands are **automated** and run in development/CI-style workflows. They **do not** launch VSCode, exercise real hooks against a live agent session, or validate extension UI.

## Manual smoke checklist (live VSCode / Cursor)

Use this list when validating **end-to-end in a real editor**. **It is not covered by the commands above**—do not treat it as CI-equivalent.

- [ ] Extension activates and writes a **bridge manifest** for the workspace (hook runtime root / manifest store).
- [ ] `UserPromptSubmit` reaches the extension host through the bridge.
- [ ] `PreToolUse` for `run_in_terminal` reaches the **review engine** (direct model call from the extension).
- [ ] Direct **`allow`** returns host **`allow`** with no extra dialog.
- [ ] Direct **`deny`** returns host **`deny`**.
- [ ] Internal **`ask`** shows **extension-owned** UI and returns final **`allow`** or **`deny`** (not host-permission ask as the target design).
- [ ] `PostToolUse` behavior matches your expectations for local runtime cleanup after the reviewed command finishes.

See also the root `README.md` and `adapter-vscode/README.md`.
