# auto-mode

[中文文档](README_cn.md)

auto-mode is an experimental AI auto-review layer for shell tool execution.

Today the mature path is `run_in_terminal`: a two-phase shell review with local glob/realpath resolution, optional second-pass review, and repeated-deny quarantine. The review prompt also treats remote download / fetch as a hard deny condition.

## Adapters

This repository currently provides two adapters:

| Adapter | Use when | User docs |
|--------|----------|-----------|
| `adapter-vscode/` | You want Auto Mode in a VSCode-compatible extension host, with plugin runtime, local bridge, extension settings, and extension-owned UI. This is not the same as supporting Cursor IDE's own agent path. | [`adapter-vscode/README.md`](adapter-vscode/README.md) |
| `adapter-cursor-cli/` | You want Auto Mode on Cursor CLI shell hooks, without relying on the VSCode extension host or bridge. | [`adapter-cursor-cli/README.md`](adapter-cursor-cli/README.md) |

## Which One Should I Choose?

- Choose `adapter-vscode/` if you are targeting the VSCode-compatible extension-host path.
- Choose `adapter-cursor-cli/` if you are wiring Auto Mode into Cursor CLI hooks.
- You can use both, but they are installed and configured separately.

## Terminology

- `adapter-vscode/` targets a VSCode-compatible extension host. Cursor may run much of that extension surface, but that should not be read as "Cursor IDE agent support already exists".
- Cursor CLI hooks are a separate host path with their own hook and permission semantics.
- GitHub Copilot agent behavior and Cursor agent behavior should be treated as different product paths even when some editor/plugin mechanisms overlap.

## How Review Works

- The mature review target today is `run_in_terminal`.
- Review is two-phase: phase 1 infers the command's filesystem effects, then local glob / realpath resolution checks what paths are actually touched; when needed, a second review pass judges the resolved paths.
- The usual outcomes are `allow` or `deny`. Some hosts may also support `ask`, depending on the adapter.
- Repeated risky shell attempts can trigger quarantine, which stops further dangerous retries earlier.
- Commands centered on remote download or fetch are currently treated as hard deny cases.

## Repository Layout

- `adapter-vscode/` - VSCode-compatible extension-host adapter
- `adapter-cursor-cli/` - Cursor CLI shell hook adapter
- `plugin-vscode-hooks/` - host hook plugin source for the VSCode-compatible extension-host adapter
- `shared/` - shared hook contracts, model clients, and review core
- `AGENTS_DOCS/` - internal implementation notes and lessons learned

## Notes

- The most mature line today is the `run_in_terminal` hook flow.
- Non-shell categories are still incomplete or experimental.
- Live validation in a real host is still recommended even when tests pass.

## License

This repository is licensed under the GNU Affero General Public License v3.0. See `LICENSE` for details.
