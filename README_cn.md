# auto-mode

Auto Mode 是一个面向 VSCode 的实验性 AI 自动审核层。

它会拦截 AI agent 执行前后的 hook 事件，对即将执行的命令进行模型审核，然后返回 `allow` / `ask` / `deny`

当前主要是自动审核 `run_in_terminal` 工具，提高工作流自动化程度。

## 这个仓库包含什么

这个仓库里有两个协同工作的运行时部件：

- `plugin-vscode-hooks/` 这是Claude Code格式的插件，vscode现已支持Claude Code插件生态
  - 给 VSCode 宿主发现的 hook plugin
  - 通过 `chat.pluginLocations` 注册（执行 `npm run install:vscode` 后通常为 `~/.auto-mode/vscode-plugin`；仓库里的目录是源码/开发态，见 `plugin-vscode-hooks/README.md`）
  - 声明 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`
  - 通过 shell wrapper 把 hook payload 转发给 Node
- `adapter-vscode/`
  - 运行在 extension host 内的 VSCode 扩展
  - 负责本地 bridge、审核引擎、UI、配置、打包和模型客户端

## 工作原理

主线路径如下：

1. VSCode 发现 hook plugin（安装后位于 `~/.auto-mode/vscode-plugin`；仓库中的 `plugin-vscode-hooks/` 为开发拷贝）
2. 宿主触发某个 hook，例如 `PreToolUse`
3. plugin 执行 `./scripts/*.sh`
4. shell wrapper 调用 hook CLI（`npm run install:vscode` 之后为 `~/.auto-mode/hook-cli/dist/hooks/cli.js`；在仓库内开发时可为 `adapter-vscode/dist/hooks/cli.js`）
5. hook CLI 转发到 extension-host bridge
6. TypeScript 审核引擎直接调用你配置的模型
7. 扩展返回 `allow`、`ask` 或 `deny`

## 当前能力范围

目前实现：

- 对 `run_in_terminal` 的真实宿主拦截
- `ask` 时使用扩展自己的确认 UI
- 在 extension host 内直连模型

目前的限制：

- shell 以外的类别仍然不完整，或者还处于实验阶段
- 端到端行为仍然建议在真实编辑器里手工验证
- hook 启动器当前主要面向类 Unix 环境

## 依赖要求

- 支持 host plugin 的 VSCode 或 Cursor
- Node.js
- `bash`
- npm
- 一个模型 API Key，支持以下其一：
  - Anthropic 兼容接入
  - OpenAI 兼容接入

## 在 VSCode 中安装

### 1. 安装 `adapter-vscode` 依赖

```bash
cd adapter-vscode
npm install
cd ..
```

先在 `adapter-vscode/` 安装扩展依赖，再回到 **仓库根目录** 运行一键安装脚本。

### 2. 构建、打包、安装扩展并部署 hook 运行时

```bash
npm run install:vscode
```

仍在 **仓库根目录** 执行，会运行 `scripts/install-vscode.sh`，它会：

- 构建 `adapter-vscode`
- 将 VSIX 输出到 `.artifacts/auto-mode.vsix`
- 将该 VSIX 安装到 VS Code（**无需**再手工执行 `code --install-extension`）
- 在 `~/.auto-mode/vscode-plugin` 生成 hook plugin 运行时副本
- 在 `~/.auto-mode/hook-cli` 部署 hook CLI（入口 `~/.auto-mode/hook-cli/dist/hooks/cli.js`）
- **安全合并** VS Code **用户**级 `settings.json`，将 `chat.pluginLocations` 指向 `~/.auto-mode/vscode-plugin`
- 仅在 `chat.plugins.enabled` **缺失**时补上 `true`

如果你曾显式关闭 host plugins，例如设置了 `chat.plugins.enabled: false`，安装器会保留这个选择。此时需要你自己重新开启 host plugins，hook runtime 才会被宿主加载。

此安装路径下 **无需** 再手工编辑 `chat.pluginLocations`。

迁移提醒：如果你以前按旧文档手工把 repo-local 的 `plugin-vscode-hooks` 目录写进了 `chat.pluginLocations`，安装器会保留旧条目并追加 `~/.auto-mode/vscode-plugin`。迁移到新的安装路径后，建议移除旧的 repo-local 条目，避免同时看到两份 plugin 来源而产生困惑。

### 3. 配置 Auto Mode 扩展设置

最少需要配置 settings.json：

```json
{
  "autoMode.modelProvider": "anthropic",
  "autoMode.modelName": "claude-3-7-sonnet-latest",
  "autoMode.apiKey": "your-api-key"
}
```

如果你使用 OpenAI 兼容网关，可以这样配：

```json
{
  "autoMode.modelProvider": "openai",
  "autoMode.modelName": "gpt-4.1",
  "autoMode.apiKey": "your-api-key"
}
```

可选配置包括：

- `autoMode.anthropicBaseUrl`
- `autoMode.openaiBaseUrl`
- `autoMode.modelTimeoutMs`

### 4. 重启或重新加载 VSCode

安装扩展并修改设置后，重新加载窗口，确保扩展和 plugin 都已经生效。

## 快速验证

完成安装后，建议先检查：

1. 扩展是否在启动时成功激活
2. 真实 AI 终端动作是否会触发 `PreToolUse`
3. 安全命令是否能被审核，而不是异常回退到宿主默认审批
4. `ask` 是否使用扩展自己的确认 UI

更详细的验证方法见：

- `plugin-vscode-hooks/README.md`
- `AGENTS_DOCS/`（实现细节与开发说明）

## 开发

TypeScript 部分：

```bash
cd adapter-vscode
npm test
npm run build
```

## 仓库结构

- `adapter-vscode/` - VSCode 扩展、hook bridge、审核引擎、UI
- `plugin-vscode-hooks/` - 宿主 hook plugin 清单和 shell wrapper
- `docs/protocol/` - 协议和集成文档
- `fixtures/` - 示例 payload、策略和决策 fixture
- `AGENTS_DOCS/` - 实现教训和补充说明

## 限制

- 当前最成熟的是 `run_in_terminal` 这条 hook 主线，其他类别还没有同等成熟度
- 自动化测试不能替代真实编辑器里的 live 验证
- 宿主 hook 生态仍在变化，不同行为可能和宿主版本有关

## License

本仓库采用 GNU Affero General Public License v3.0 许可。详见 `LICENSE`。
