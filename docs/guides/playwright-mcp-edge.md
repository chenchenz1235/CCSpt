# 让 AI 连接你正在使用的 Edge

用 Playwright MCP 和官方扩展，AI 可以访问你选定的 Edge 标签页，利用已有登录状态读取页面、查找入口、辅助填表。[微软官方说明](https://github.com/microsoft/playwright/tree/main/packages/extension#readme)

## 直接把这段交给 AI

```text
请读取这篇指南，帮我配置 Playwright MCP，连接 Windows 上正在使用的 Edge：
https://github.com/chenchenz1235/CCSpt/blob/main/docs/guides/playwright-mcp-edge.md

检查当前客户端是否支持本地 MCP，以及 Node.js、npx、Edge 和现有 MCP 配置。
按官方文档使用 --extension --browser msedge，修改前备份，只调整相关配置，
保留其他服务和设置，避免重复注册。记录实际包版本。
指导我安装官方 Playwright Extension；网站登录和标签页授权由我完成。
配置后实际检查工具是否加载，必要时提示重启或新建聊天。
先调用 browser_tabs，再用 browser_snapshot 读取我授权的普通网页，
返回标题、URL 和内容摘要。本次只读，不保存或提交业务数据。
能执行的步骤请直接完成，明确报告尚需我操作或未验证的部分。
```

需要能执行本机命令、修改配置并调用 MCP 的 AI 客户端。仅能阅读仓库的网页聊天，不能替你修改本机配置。

## 配置的关键点

- **扩展：**在日常使用的 Edge 个人资料中安装 [官方 Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。Edge 可能要求允许其他商店的扩展。
- **依赖：**上游要求 Node.js 18+；新安装选择仍受支持的 LTS，并核对当前包要求。
- **连接：**必须有 `--extension`。单独配置 `--browser msedge` 不能证明接入了你日常的登录会话。
- **版本：**下面用 `@latest` 方便试用；实际安装时记录版本，团队推广可固定已验证版本。

Codex CLI 示例（已有同名服务时先比较，不要重复添加）：

```powershell
codex mcp add playwright -- npx -y @playwright/mcp@latest --extension --browser msedge
codex mcp list
```

或合并到实际生效的 `config.toml`，默认用户路径为 `%USERPROFILE%\.codex\config.toml`：

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest", "--extension", "--browser", "msedge"]
startup_timeout_sec = 60
tool_timeout_sec = 120
```

两种方式选一种。超时配置为首次下载和人工授权留出时间；如果 Windows 无法启动 npx，让 AI 检查 PATH 和实际 `npx.cmd`，按客户端启动方式修正。其他客户端采用自己的 MCP 配置格式。[OpenAI MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp)

## 首次体验与以后怎么用

先在 Edge 打开 [Example Domain](https://example.com/)，对 AI 说：

> 使用 Playwright MCP 连接 Edge，读取我选择的当前页面。返回标题、URL 和主要内容，本次只读。

弹出选页窗口时，点击**目标网页**右侧的 **Allow & select**。**Welcome** 且地址为 `chrome-extension://...` 的是扩展连接页，不是业务页面。

读取成功后，就可以说：

> 使用 Playwright MCP 连接 Edge，进入“指定菜单 → 指定申请单”，打开新表单并填写我提供的产品编码，核对自动带出的信息。缺少的业务内容问我，本次不保存、不发送。

以后通常直接用“使用 Playwright MCP 连接 Edge……”描述任务即可。重启、断线或切换个人资料后，可能需要重新授权。

## 实际容易遇到的问题

| 问题 | 关键处理 |
|---|---|
| 配置写了，AI 却没有工具 | 重载客户端或新建聊天，检查 MCP 启动错误；配置成功不等于连接成功 |
| AI 读到的不是你眼前的页面 | 以 browser_tabs 返回的标题、URL 为准；切换普通标签不会保证受控目标同步切换 |
| 找不到标签或新弹出的表单 | 检查授权与 Playwright 标签组，将目标标签拖入当前客户端的组；各客户端只能访问分配给自己的页面 |
| 点击菜单后无变化 | 检查新窗口和弹窗拦截；优先接入已打开的表单，避免重复创建。必要时使用页面实际提供的入口链接 |
| 菜单悬停后消失、字段定位失败 | 重新展开并读取快照；表单可能在 iframe 内，不要连续复用失效引用 |
| 填了编码，关联信息没更新 | 触发失焦，等待并重新读取，核对系统实际带出的结果 |
| 页面提示“测试表单” | 核实环境用途，不把编辑或点击发送当作正式流程成功 |

填写在编辑页**不等于保存了草稿**。需要保留时明确要求“保存待发”，并核对结果；保存、发送、审批的授权范围也要说清楚。业务信息缺失时应补充，不能让 AI 编造。

## 验证范围与数据

2026-11-04 已在本机验证：Edge 标签页授权、OA 页面及菜单读取、新建表单编辑、填写编码后自动带出关联信息。未保存、发送或审批；未验证全新电脑安装、其他客户端及完整业务流程。

使用公司系统前确认所用 AI 服务符合公司数据要求。页面内容会交给 AI 客户端处理，浏览器授权不代表数据只在本机。公开反馈不要上传业务截图、Cookie、密码或扩展令牌。本文保留人工连接授权，无需配置免确认令牌。

官方文档：[Playwright MCP](https://github.com/microsoft/playwright-mcp#readme) · [扩展安装、标签组与排错](https://github.com/microsoft/playwright/tree/main/packages/extension#readme) · [OpenAI MCP](https://learn.chatgpt.com/docs/extend/mcp)
