---
name: doc-maintenance
description: >-
  Maintain repository documentation alongside code changes: assign document responsibilities,
  preserve facts and author voice, control growth, review reader tasks, synchronize bilingual
  sections, and run local consistency checks. Use for documentation audits, README or guide
  revisions, code-to-doc synchronization, and bilingual maintenance. Ordinary coding, prose
  translation outside a repository, and unrelated note organization do not activate this workflow.
---

# Doc Maintenance

帮助 coding agent 在现有仓库中维护准确、可用、表达稳定的文档。按用户请求处理指定文件或当前变更；全库整理需要相应任务范围。沿用项目的语言、目录、术语、验证命令和授权，不因使用本 Skill 就创建新文档体系或改 Git 配置。

## 从当前任务开始

1. 读适用的项目指令、目标文档及其事实来源。代码变更涉及命令、配置、默认值、行为或限制时，沿引用查找受影响的文档。先确定主要归属，再决定修改位置。
2. 说明读者需要完成什么、哪些事实必须保留。修订授权允许范围内的清晰问题；只要求审查时报告发现，不顺便重写。必要的调用条件、失败和完成时机保留在使用处，长篇理由链接到主要归属。
3. 按实际任务读取下面相应参考，不默认全读或调用多代理。小改动直接局部处理；未知的事实回到源码、测试或实际操作核对，不用旧文档互相证明。
4. 运行适当的检查，复读完整改动。报告改了什么、依据、实际运行的检查及其范围，以及仍未验证的行为或语义。

## 按需读取

- 分工、重复内容、篇幅增长、教程与参考、决策历史：[organization.md](references/organization.md)。
- 写作、术语、人工样例、精简时保护事实：[editing.md](references/editing.md)。
- 双语失步、确认记录、局部更新、普通 Git 合并：[bilingual.md](references/bilingual.md)。
- 配置、命令、Git 暂存区与 CI 接入：[checks.md](references/checks.md)。
- 生成参考、示例/类型验证、网站发布及真实任务验收：[verification.md](references/verification.md)。

## 本地工具

工具位置以此 Skill 的目录为准，不假定它位于当前项目。需要 Node.js 22+，在工具目录先运行 `npm ci --ignore-scripts`。不需要模型密钥。

```sh
node /path/to/doc-maintenance/scripts/doc-maintenance.mjs check --root /path/to/project
```

路径示例需替换为实际绝对路径。`check` 只读，不运行项目命令、不刷新确认记录。配置是项目根目录可选的 `.doc-maintenance.json`，语义见 [checks.md](references/checks.md)。不要为使用工具给无关项目写配置。

日常只检查指定文件可用 `--files README.md docs/guide.md`；检查当前修改可用 `--changed HEAD`；提交前用 `--staged`。后两者要求 `--root` 是 Git 仓库根目录。Git 操作前查看变化文件，提交时只暂存明确范围。

## 保留判断边界

- 自动检查可以发现路径、结构、预算和记录失步；没有证实翻译语义、源码行为或读者体验。
- 修改双语后先核对两侧完整含义，再显式执行 `confirm --pair PATH --reviewed`。已有任务授权足够时由当前 agent 完成核对，无需反复请求许可；不要把 `--reviewed` 当作让检查变绿的开关。
- 项目命令只通过显式 `run NAME` 执行。先读其 argv 和可能的副作用，遵守当前任务授权。命令失败不替它改预期，不隐藏日志，不报告未运行的验证。
- 记录冲突保留给内容判断；不安装自定义 Git 合并驱动，不自动选择一侧覆盖另一侧。
- 不为省字删掉条件、例外和责任，不把历史文件润色成当前规则，不自动全文重译。
