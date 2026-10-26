# doc-maintenance

最近在读 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的仓库。我对他们怎么让中英文文档保持一致很感兴趣，就看了看相关文档和提交记录，整理了一些值得借鉴的做法：

- 每类文档各有职责。同一个事实有主要归属，其他地方链接过去，减少重复解释。
- 给容易越写越长的文件设上限，比如 `AGENTS.md` 和架构总览。超限后先看内容是不是放错了地方，再考虑精简。
- 中英文都可以先写。记录上次确认一致的内容，下次只处理有变化的部分，尽量保留已经改好的表达。
- 用认可的样例和术语约定来统一写法。精简时保留条件、例外和失败后果。
- 能自动检查的交给脚本，比如链接、代码块和双语记录。意思有没有变，还是要对照来源看。

我把这些经验做成了 **doc-maintenance**，一个给 coding agent 用的 Skill，附带几项检查脚本。可以用它整理 README、让文档跟上代码变更，或者维护中英文版本。项目已有的写法和工具会尽量沿用，双语检查、篇幅预算这些按需开启。

具体参考的提交和贡献者放在 [NOTICE.md](NOTICE.md)。这是我根据 DSH 的做法整理的独立实现。

## 使用

需要 Node.js 22 或以上版本。先克隆仓库、安装依赖：

```sh
git clone https://github.com/XSY-28/doc-maintenance.git
cd doc-maintenance
npm ci --ignore-scripts
```

把完整目录放到你使用的 coding agent 支持的 Skill 目录中，入口是 [SKILL.md](SKILL.md)。不要只复制这一份文件，配套的脚本和参考也需要保留。

然后可以让 agent 做这样的事：

> 使用 doc-maintenance，按这次代码修改更新相关文档，同步中英文，保留没涉及的内容。

也可以先跑仓库自带的例子：

```sh
node scripts/doc-maintenance.mjs check --root examples/minimal
node scripts/doc-maintenance.mjs run generated --root examples/minimal
```

脚本有四个命令：`check` 检查文档，`confirm` 记录核对过的双语内容，`brief` 从 Git 历史里找修改前后的文本，`run` 执行项目配置的检查命令。`check` 只读，不会自动修改文档或刷新确认记录。

项目配置和命令用法见[检查说明](references/checks.md)，双语维护见[双语说明](references/bilingual.md)。

## 验证

```sh
npm test
npm run check
```

目前在 macOS、Node.js 24 下验证过。其他平台还没有实测，脚本检查也不能代替对内容的核对。

[MIT License](LICENSE)
