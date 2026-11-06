# 用脚本直连 Edge，让 AI 操作 OA

当前推荐入口改为 **Playwright 脚本 + CDP + 专用 Edge**，无需 Playwright MCP 或扩展。通过本地脚本读取页面、定位 iframe、填写研发日报；正式发送前在聊天里确认。

## 直接交给 AI

```text
请读取 https://github.com/chenchenz1235/CCSpt/tree/main/labs/skills/oa-control ，
帮我安装其中的 oa-control Skill 和脚本依赖，用 Edge/CDP 连接我的 OA。
先检查 Node.js 和 Edge，复制配置示例后让我提供 OA 地址，保留已有本地配置。
默认由我人工登录；先验证当前页面标题、URL 和登录状态，再开始只读查询。
登录和正式发送前分别让我确认；项目存在多个匹配时列候选让我选择。
不要默认启用可选的凭据保存方法。后续表单按实际验证逐步积累，不上传业务数据。
```

## 和之前 MCP 方式的区别

原方式需要 MCP 服务、浏览器扩展和标签授权；现在 AI 直接运行本机 Playwright 脚本，连接 `http://127.0.0.1:9222` 的专用 Edge。
这不是自动接管日常 Edge：启动器使用独立 user-data-dir，首次需要在该窗口登录。浏览器密码保存与 OA 会话有效期是两件事。
已有 MCP 配置无需为此自动删除；这里只替换本仓库的默认使用说明。

## 首次使用

见 [Skill 安装与命令](../../labs/skills/oa-control/README.md)。配置 OA 地址后：

```powershell
node scripts/oa.mjs start
# 在打开的专用 Edge 内登录
node scripts/oa.mjs status
node scripts/oa.mjs tabs
```

后续可以说“控制 OA，查看某张单据为何没结束”，或“填写今天日报”。当前包括通用查询和日报参考，其他表单会逐步补充。
正式发送前展示实际内容；编辑页已填不等于已保存或已发。发送后核对已发详情，避免重复提交。

## 可选登录参考

[Windows 本机加密登录](../../labs/skills/oa-control/references/optional-login.md) 供确实需要离开电脑操作的人自行参考，不作为默认或推荐方式。启用与安全风险由使用者评估，不提供实际凭据。

## 验证范围

既有本机脚本在 2026-11-06 完成过 Edge/CDP 连接、列表和流程读取、日报填写及确认后发送并核对已发详情。公开整理版去掉公司地址、个人路径、项目号和单据数据；全新电脑安装、其他 OA 配置及其他表单尚需验证。
使用脚本仍会把读取内容交给所用 AI 客户端处理；CDP 仅绑定本机，并不等于业务数据只在本机处理。
