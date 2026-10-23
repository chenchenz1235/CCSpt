# 正式 Skills

## 安装目录

| 名称 | 用途 | 版本 | 依赖 |
|---|---|---|---|
| ccspt-code-review | 审核工具集入口 | 0.1.0 | 两个下列专项 |
| ccspt-motor-parameter-review | 电机参数及派生计算审核 | 0.3.0 | 无 |
| ccspt-thermostat-logic | 温控文档、要求核对与实现自检 | 0.2.0 | 无 |

机器可读索引：[catalog.json](catalog.json)。维护源：[ccspt-code-review-skill](https://github.com/chenchenz1235/ccspt-code-review-skill)，插件版本 0.4.0。源仓库保持独立，这里不复制 skill 内容。

## 给安装 AI 的步骤

1. 读取 catalog.json，按用户指定的 skill 解析依赖；用户只要求“安装 CCSpt skills”时采用 default_install。
2. 使用当前宿主支持的 skill 安装器，从条目的 repo、ref、path 安装。ref 锁定为已核对的提交 `7d2c1444d2bd976312fcd5cef2ae956653bc7925`，不得悄悄改为 main。
3. 总入口需要两个专项一起安装到同一个 skills 父目录。两个专项可以独立安装。不要把本目录或仓库根目录当成 skill。
4. 已有同名目录时先核对来源、版本及本地改动，变更前备份；安装器拒绝覆盖时按现有授权处理，不删除其他技能或修改无关配置。
5. 验证每个目录有 SKILL.md、name 与目录名匹配、VERSION 与清单一致，引用资源与总入口的两个相邻专项完整，再报告结果。

Codex 的内置 `$skill-installer` 支持按 GitHub 仓库及子目录安装。安装器的 CLI 参数形式如下；`<installer>` 表示该宿主实际提供的安装器脚本路径，不是本仓库附带的文件：

```text
python <installer> --repo chenchenz1235/ccspt-code-review-skill --ref 7d2c1444d2bd976312fcd5cef2ae956653bc7925 --path plugins/ccspt-code-review-skill/skills/ccspt-code-review plugins/ccspt-code-review-skill/skills/ccspt-motor-parameter-review plugins/ccspt-code-review-skill/skills/ccspt-thermostat-logic
```

支持插件分发的宿主可参考[源仓库安装说明](https://github.com/chenchenz1235/ccspt-code-review-skill#安装与更新)。插件安装跟随源仓库发布，不等同于上面的提交锁定方式。宿主不支持本地安装时，AI 应说明限制，不能声称已安装。

官方说明：[Build skills](https://learn.chatgpt.com/docs/build-skills)。本仓库不会把授权安装等同于授权修改工程代码。

## 调用

```text
使用 $ccspt-code-review 审核 <工程路径>，范围包括参数审核和温控实现自检。
使用 $ccspt-motor-parameter-review 审核 <参数文件>，立项单为 <路径>。
使用 $ccspt-thermostat-logic 根据 <模型或代码> 生成温控逻辑文档。
```

参数正式审核需要项目立项依据；客户温控要求核对需要原始需求。具体条件以各 skill 为准。

发布验证：已按 catalog.json 从 GitHub 指定提交实际安装三个 skill 到隔离目录，名称、版本、相邻依赖和 Markdown 引用检查通过；没有覆盖当前用户的安装。
