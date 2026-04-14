# auto-mode

[English documentation](README.md)

Auto Mode 是一个实验性的 AI shell 自动审核层。

当前最成熟的主线是 `run_in_terminal`：两阶段 shell 审核、本地 glob/realpath 解析、按需二次复审，以及 repeated-deny quarantine。当前审核 prompt 也会把远程下载 / 拉取内容视为硬拒绝条件。

## 适配器

这个仓库当前提供两个 adapter：

| Adapter | 适用场景 | 用户文档 |
|--------|----------|----------|
| `adapter-vscode/` | 你要走 VSCode-compatible 扩展宿主路径，需要 plugin runtime、本地 bridge、扩展设置和扩展 UI。Cursor 即便兼容不少 VSCode 扩展机制，也不等于这里已经支持了 Cursor IDE 自己的 agent 主线。 | [`adapter-vscode/README.md`](adapter-vscode/README.md) |
| `adapter-cursor-cli/` | 你要把 Auto Mode 接到 Cursor CLI shell hooks，不依赖 VSCode extension host 或 bridge。 | [`adapter-cursor-cli/README.md`](adapter-cursor-cli/README.md) |

## 我该选哪个？

- 如果你要接入 VSCode-compatible 扩展宿主路径，选 `adapter-vscode/`
- 如果你是给 Cursor CLI hooks 接入，选 `adapter-cursor-cli/`
- 两者可以并存，但安装方式和配置方式是分开的

## 术语说明

- `adapter-vscode/` 面向的是 VSCode-compatible 扩展宿主，不应被解读为“已经支持 Cursor IDE 自身 agent 路径”。
- Cursor CLI hooks 是另一条宿主路径，hook 契约和权限语义独立。
- GitHub Copilot agent 与 Cursor agent 即便共享部分编辑器/插件机制，也应视为不同产品路径。

## 审核如何工作

- 当前成熟的审核目标是 `run_in_terminal`
- 审核分两阶段：phase 1 先推断命令的文件系统影响，再通过本地 glob / realpath 解析确认真实触达路径；必要时再做一次基于解析后路径的复审
- 常见结果是 `allow` 或 `deny`；有些宿主还可能支持 `ask`，具体取决于 adapter
- 如果危险 shell 尝试反复出现，可能触发 quarantine，更早拒绝后续高风险重试
- 以远程下载或拉取内容为核心目的的命令，当前会被视为硬拒绝

## 仓库结构

- `adapter-vscode/` - VSCode-compatible extension-host adapter
- `adapter-cursor-cli/` - Cursor CLI shell hook adapter
- `plugin-vscode-hooks/` - 给 VSCode-compatible 扩展宿主路径使用的 hook plugin 源码
- `shared/` - 共用 hook 契约、model client 和 review core
- `AGENTS_DOCS/` - 内部实现说明和踩坑记录

## 说明

- 当前最成熟的主线是 `run_in_terminal` hook flow
- shell 以外的类别仍然不完整，或还处于实验阶段
- 即使自动化测试通过，仍建议在真实宿主里做一次 live 验证

## License

本仓库采用 GNU Affero General Public License v3.0 许可。详见 `LICENSE`。
