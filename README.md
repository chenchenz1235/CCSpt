# CCSpt 工具导航

给嵌入式软件同事使用的工具入口：找工具、下载试用、安装 skills、反馈问题。GitHub 的提交与合并可以由 AI 协助处理。

## 我要做什么

| 目标 | 入口 |
|---|---|
| 给 AI 安装正式审核 skills | [Skills 安装与目录](skills/README.md) |
| 试用 EmbedMerge 比较软件 | [EmbedMerge 0.7.0](labs/apps/EmbedMerge/README.md) |
| 下载软件包 | [Releases](https://github.com/chenchenz1235/CCSpt/releases) |
| 找正式软件 | [Apps](apps/README.md) |
| 找独立脚本 | [Scripts](scripts/README.md) |
| 提供自己的 DIY 工具 | [实验区](labs/README.md) · [提交说明](CONTRIBUTING.md) |
| 反馈问题或建议 | [新建 Issue](https://github.com/chenchenz1235/CCSpt/issues/new) |

## 让 AI 安装 skills

把以下文字发给支持本地 skill 安装的 AI：

> 请读取 https://github.com/chenchenz1235/CCSpt 的 skills/README.md 和 skills/catalog.json，安装 default_install 中的正式 skills，解析依赖并保持相邻目录。按清单指定的源仓库、版本提交及路径安装，验证实际文件；已有同名安装先比较并备份，报告安装或更新结果。不要把总导航仓库当作一个 skill。

这里是导航，不是可直接安装的 skill。真实 skill 在索引指定的源仓库中独立维护；支持插件的宿主也可以使用源仓库的插件安装方式。

## 目录与状态

```text
CCSpt/
├── skills/       正式 skills 的目录、版本与安装来源
├── apps/         正式软件目录
├── scripts/      正式独立脚本目录
└── labs/         员工 DIY 与试用工具
    ├── skills/
    ├── apps/
    └── scripts/
```

`labs` 中的工具尚在试用，说明中列出验证范围与已知限制；正式区要求明确的用途、维护人、使用说明及必要验证。成熟工具发布到相应正式项目后，在导航中更新状态和链接，不复制多份源码。

本仓库公开可见。当前发布 EmbedMerge 试用软件包及导航文档，另有整理后的 EmbedMerge 开发源码供 DIY，没有导入个人任务数据、员工工程或整个原开发目录。软件包可能包含运行所需的脚本和资源，并非对源代码的保密封装。各工具的许可分别说明；公开可下载不等于已授予开源许可。
