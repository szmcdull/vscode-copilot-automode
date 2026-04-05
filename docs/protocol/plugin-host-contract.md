# 插件宿主契约

## 第一条真实宿主路径

第二阶段插件化落地的**第一条真实宿主路径**固定为：

- VSCode/Cursor 扩展命令触发的**受控 shell 审核执行**

推荐交互形态：

- 命令面板执行命令，例如 `Auto Mode: Run Reviewed Shell Command`
- 扩展主动收集用户输入的 shell 命令
- 扩展自身负责把该命令送入现有 shell interceptor / review engine / ask / execution handoff 链路

这条路径的目标是证明：

1. 扩展可以被真实安装和激活
2. 扩展可以在 extension host 内直连模型完成审核
3. 用户可以在宿主里看到 ask / allow / deny 的真实交互
4. 审核结果能影响最终执行

## 为什么先做受控命令入口

当前已知现实约束：

- VSCode 提供 terminal shell integration、commands、tasks、UI 等公开 API，但“透明拦截一切高权限动作”并不是稳定可验收前提
- Cursor 对标准 VSCode 扩展大概率兼容，但其内部 agent/tool 调用链并不等于公开扩展 API
- 若一开始追求隐式 hook，很容易把“原型逻辑正确”拖成“宿主接线不可验证”

因此本阶段先把“可安装、可启动、可使用”做实，再评估更深层的透明拦截能力。

## 第二阶段真实支持范围

真实接宿主的路径：

- `shell`：通过扩展命令触发的受控执行入口

已有内核但暂未承诺真实宿主接线：

- `file_write`
- `file_edit`
- `git`
- `network`
- `mcp`

协议已建模但尚无宿主实现：

- `file_read`
- `browser`
- `task`
- `custom_tool`

## 保守降级规则

以下情况必须保守：

- 宿主无法稳定观测完整上下文时，不能伪装成“已真实拦截”
- 部分观测的 `git` / `network` 继续降级为 `ask`
- 未知或部分观测的 `mcp` 继续降级为 `ask`
- 无法接到真实宿主 API 的类别，必须在 README 中明确写成 blind spot，而不是暗示“应该能工作”

## 责任边界

VSCode/Cursor 扩展负责：

- 真实宿主入口
- 宿主事件 -> `ShellReviewInput`
- 直连模型完成审核
- ask 用户交互
- 最终执行 handoff

## 非目标

本阶段不承诺：

- 透明拦截 Cursor 内置 agent 的全部工具调用
- 在没有公开宿主 API 的情况下无侵入接管高权限动作
- 覆盖所有 category 的真实宿主级接线
