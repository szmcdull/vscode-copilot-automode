# adapter-cursor-cli
Auto Mode adapter for Cursor CLI shell hooks.

## Install and Use

### What it does

- Handles Cursor CLI `beforeShellExecution` and `preToolUse`
- Maps Cursor hook payloads into Auto Mode review input
- Returns Cursor-compatible `allow` / `deny` JSON
- Defaults to `dry-run` when review env is not configured

### Build

```bash
npm install --prefix adapter-cursor-cli
npm run build --prefix adapter-cursor-cli
```

### Wire it into Cursor CLI hooks

Keep the live Cursor hooks config outside the repository root `.cursor/` unless you intentionally want it to auto-load for this workspace. This repository keeps an example manifest at `adapter-cursor-cli/hooks.example.json`.

Configure your Cursor hooks to call the wrapper. The snippet below is correct for project-level config inside this repository. If you use a user-level hooks config, change the command to an absolute path.

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {
        "command": "bash ./adapter-cursor-cli/scripts/run-cursor-cli-hook.sh beforeShellExecution",
        "failClosed": true
      }
    ],
    "preToolUse": [
      {
        "matcher": "Shell",
        "command": "bash ./adapter-cursor-cli/scripts/run-cursor-cli-hook.sh preToolUse",
        "failClosed": true
      }
    ]
  }
}
```

You can also start from the checked-in example file:

```bash
cp ./adapter-cursor-cli/hooks.example.json /path/to/your/.cursor/hooks.json
```

The wrapper runs:

```bash
node ./adapter-cursor-cli/dist/adapter-cursor-cli/src/hookEntry.js beforeShellExecution
```

### Choose a mode

#### Dry-run

```bash
AUTO_MODE_CURSOR_CLI_MODE=dry-run
```

Optional:

```bash
AUTO_MODE_CURSOR_CLI_DRY_RUN_DECISION=deny
```

#### Real review

Set at least:

```bash
AUTO_MODE_CURSOR_CLI_MODE=review
AUTO_MODE_API_KEY=...
AUTO_MODE_MODEL_NAME=...
```

Optional:

```bash
AUTO_MODE_MODEL_PROVIDER=openai
AUTO_MODE_OPENAI_BASE_URL=...
AUTO_MODE_MODEL_TIMEOUT_MS=120000
```

### Review behavior

- The mature review target is `run_in_terminal` shell execution
- The adapter uses the same two-phase review model: phase 1 infers accesses, local glob / realpath resolution checks the actual paths, and phase 2 runs when the resolved paths need extra review
- In `dry-run`, the adapter returns the configured dry-run decision without calling a model
- In real review mode, model configuration comes from environment variables
- Cursor CLI has no extension-owned confirmation UI, so any internal `ask` outcome is contracted to `deny`
- Repeated risky attempts may be denied earlier by quarantine behavior

### Start using it

1. Build `adapter-cursor-cli`
2. Enable one of the modes above
3. Put the hook config in your Cursor hooks config
4. Run a shell action through Cursor CLI and confirm the hook returns `allow` / `deny`

## Development and Debugging

### Manual smoke check

```bash
node ./adapter-cursor-cli/dist/adapter-cursor-cli/src/hookEntry.js beforeShellExecution --no-stdin
```

### Useful debugging controls

- `--no-stdin` skips stdin reads for local smoke tests
- `AUTO_MODE_HOOK_STDIN_TIMEOUT_MS` limits waiting time if stdin never closes
- `AUTO_MODE_SKIP_CURSOR_HOOK=1` bypasses the hook wrapper for local recovery/debugging

### Test and rebuild

```bash
npm test --prefix adapter-cursor-cli
npm run build --prefix adapter-cursor-cli
```
