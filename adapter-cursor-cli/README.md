# adapter-cursor-cli
Auto Mode adapter for Cursor CLI shell hooks.

## What It Does

- Handles Cursor CLI `beforeShellExecution` and `preToolUse` shell hooks.
- Maps Cursor hook payloads into Auto Mode review input.
- Returns Cursor-compatible `allow` / `deny` JSON.
- Defaults to `dry-run` when review env is not configured, so local development is still usable.

## How To Build

```bash
npm install --prefix adapter-cursor-cli
npm run build --prefix adapter-cursor-cli
```

## How To Use

The project hook config calls:

```bash
bash ./.cursor/hooks/run-cursor-cli-hook.sh beforeShellExecution
```

That wrapper runs the built adapter entry:

```bash
node ./adapter-cursor-cli/dist/adapter-cursor-cli/src/hookEntry.js beforeShellExecution
```

## Modes

### Dry-run

```bash
AUTO_MODE_CURSOR_CLI_MODE=dry-run
```

Optional:

```bash
AUTO_MODE_CURSOR_CLI_DRY_RUN_DECISION=deny
```

### Real review

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

## Manual Smoke Check

```bash
node ./adapter-cursor-cli/dist/adapter-cursor-cli/src/hookEntry.js beforeShellExecution --no-stdin
```
