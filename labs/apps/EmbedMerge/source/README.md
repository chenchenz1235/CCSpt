# EmbedMerge 0.7.0 开发源码（DIY 试用）

保留 app/ 与 new-project-kit/fixtures/ 的相邻关系。开发需要 Node.js 22.12+（依赖 Vite 的要求）；本次验证环境与结果见源码发布页。

在 app/ 中执行：

```text
npm ci
npm test
npm run build
npm start
npm run package
```

npm ci 会安装开发依赖，Electron 安装脚本需要网络下载运行时。npm run package 生成 app/release/EmbedMerge/，保留已有 data/，对外发布前另做排除 data 的干净包。package 脚本会打包 app/dist 与合成 fixtures。

MATLAB 相关功能严格要求本机 MATLAB R2024b，不需要额外 MATLAB MCP；Codex AI 功能目前仅支持本机 Codex CLI、App Server 和个人登录，且禁用外部 MCP。普通文本比较与这两项可选功能独立。

本源码包含程序、依赖锁文件、合成 fixtures、单元测试、打包及基础 UI 测试脚本。排除了 node_modules、生成的 dist/release、个人 data/、任务、备份、日志、验收历史、实际公司工程测试样本，以及依赖本地历史任务的人工调试脚本。

CS+ 单元测试中依赖原私有真实样本的一项，在这些样本不存在时明确跳过；其余合成测试保留。源码副本仅为公开测试适配这一跳过条件，未修改原开发工程及业务逻辑。示例目录中数据为合成演示，不代表真实客户参数。

首次运行与 DIY 请使用工程副本。0.7.0 默认直接操作所选原文件，保存、复制、覆盖和删除可能改动文件。改版请用独立版本号并记录改动和测试；不要把自改版本当作官方发布。

第三方许可证仍适用。EmbedMerge 的独立开源许可证尚未指定，公开源码不自动授予未声明的再分发许可。

本次公开副本验证环境：Node.js v24.14.0。使用 npm ci --ignore-scripts 安装锁定依赖，npm run build 通过；npm test 共 61 项，59 通过，2 跳过（真实私有样本未分发、文件系统不支持硬链接）。未执行 npm start、npm run package 或真实 MATLAB/Codex 端到端验证；Electron 安装脚本下载运行时未在本次执行。
