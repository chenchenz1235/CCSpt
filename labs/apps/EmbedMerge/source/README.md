# EmbedMerge 0.11.5 开发源码（DIY 试用）

保留 app/ 与 new-project-kit/fixtures/ 的相邻关系。开发需要 Node.js 22.12+。

在 app/ 中执行：

```text
npm ci
npm test
npm run build
npm start
npm run package:zip
```

npm ci 会下载 Electron 运行时。package:zip 生成 app/release/EmbedMerge-0.11.5-windows-x64.zip，只按 PACKAGE_MANIFEST.json 中已验证的文件打包，排除安装目录内 data、历史任务和遗留文件。不要整体压缩使用过的安装目录。默认不附带私有固件配置，详见 app/打包与AI接入说明.txt。

普通文本比较不依赖 MATLAB 或 AI。MATLAB 路径可在无工程时配置，不按年份限制版本；实际比较仍需对应函数、工具箱及许可证。AI 使用本机 Codex 或 Claude Code CLI 及个人登录，保留本机原生工具、技能与 MCP。权限、配置方法和真实调用未验证事项见 [项目说明](../README.md) 与包内文档。专用参数审核按钮仍使用 Codex。

本源码仅包含程序、锁定依赖、合成样例和选定测试脚本，不包含实际公司工程、个人 data、凭据或私有固件运行配置。CS+ 私有样本未分发，对应一项测试明确跳过；保留公开适配，不把缺失样本当作通过。

公开副本验证环境为 Node.js v24.14.0；npm ci --ignore-scripts 安装锁定依赖，npm test 共 140 项、138 通过、0 失败、2 跳过（未分发的私有样本、文件系统不支持硬链接）；npm run build 通过。本次未在公开副本启动 GUI 或重新打包，已有 EXE 测试来自本地发行构建。开发副本及真实 EXE 的已有验证与边界见 [发布说明](https://github.com/chenchenz1235/CCSpt/releases/tag/embedmerge-v0.11.5)。GUI 模拟结果不能代替真实账号、MATLAB 实际模型比较或实机验证。

首次请用工程副本；原生 AI 命令可以直接写工作目录，软件备份不覆盖所有原生写入。第三方许可证仍适用。EmbedMerge 的独立开源许可证尚未指定，公开源码不自动授予未声明的再分发许可。
