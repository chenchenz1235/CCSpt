# oa-control：Edge/CDP OA 操作助手

**试用版 0.1.0 · Windows + Microsoft Edge + Node.js 20+ · 维护：chenchenz1235**

直接用 Playwright 脚本连接开启远程调试的专用 Edge，读取页面和流程、查询待发与已发，并指导 AI 填写研发日报。后续其他表单按实际验证逐步加入。无需 Playwright MCP 和扩展。

## 安装与首次使用

将本目录放到 Codex 的 skills 目录，目录名保持 `oa-control`。例如使用 AI 安装器明确指定仓库 `chenchenz1235/CCSpt` 的 `labs/skills/oa-control`；本技能在试用区，不属于正式 skills 默认安装集合。不要用仓库根目录覆盖 skills。

在本技能目录执行：

```powershell
npm ci --ignore-scripts
Copy-Item config.example.json config.local.json
```

编辑 `config.local.json`，将 `oaUrl` 改成自己的 OA 首页。必要时指定 `edgePath`；其他字段可保留默认值。示例地址不能用于实际登录。依赖固定为 playwright-core 1.65.0，不下载其他浏览器；使用本机 Edge。

```powershell
node scripts/oa.mjs start
# 在新开的专用 Edge 中自行登录 OA
node scripts/oa.mjs status
node scripts/oa.mjs tabs
node scripts/oa.mjs query waiting
node scripts/oa.mjs query sent "日报"
node scripts/oa.mjs capture --url "method=main"
```

`waiting` 是“待发”，不是“待办”；查询只读取当前结果页。`find` 仅查当前已加载页面文字，不是 OA 全库检索。`--url` 是用已观察到的 URL 子串选定唯一页面。

以后对 AI 说：

> 使用 $oa-control 帮我填写今天的项目日报。先核对已登录状态；需要登录和正式发送前分别让我确认。项目有多个匹配时列出编号与版本让我选择。今日工作和明日计划如下……

## 登录方式

默认人工登录，关闭 Edge 后 OA 可能要求重新登录，保存浏览器密码不等于保存 OA 会话。

需要离开电脑也能在聊天确认登录的人，可自行参考 [Windows 本机加密登录方法](references/optional-login.md)。它不是默认或推荐方式；启用及风险由使用者自行评估。不包含实际凭据，不自动启用。

## 验证范围

2026-11-06 的本机既有脚本已验证 Edge/CDP 连接、OA 页面与列表读取、项目选择、日报今日工作及明日计划填写、用户确认后发送和已发详情核对，以及可选登录方法。
本目录为去个人配置后的便携整理版本：运行 `npm test` 检查配置和本地页面上的 CDP 操作；这不证明另一套 OA 的字段/流程相同。首次用于自己的 OA 时，先只读验证再填写，正式发送始终需要当次确认。
不提供自动审批、批量删除或定时发送。当前日报操作由 AI 按参考文档与页面状态执行，CLI 不会自行发送表单。

运行目录 `.state/` 保存采集结果，`.edge-profile/` 保存专用浏览器资料。公开分享只提交代码和清洁示例。第三方依赖许可见其包元数据；本仓库未另授予统一软件许可。
