# 双语章节记录和局部更新

## 何时使用

项目确实维护两种语言时才启用。任一侧都可先写；配置字段 `source` 仅提供稳定的章节键，不代表其事实永远优先。发生内容分歧时回到代码、证据和用户意图判断。

每个配置的配对有 source、target 和 record 三个路径。普通检查同时核对完整性、结构、技术标识符、语言对应链接和章节记录；段落可以按目标语言自然组织，无需逐行照译。

YAML frontmatter 的键、数据类型和技术值保持一致；仅名为 `title`、`description`、`summary`、`abstract` 的字符串值允许本地化。这是首版保守约定，其他本地化字段需要先确定项目需求再扩展，不能默默跳过。

## 修改和确认

1. 找到本次实际变化以及已有确认基准，查看两侧对应章节。
2. 局部同步事实，保护条件、限制和例外；检查术语首次出现位置是否因修改而变化。两侧同时改变时先判断各自含义，不覆盖其中一侧。
3. 内容核对完成后，对该配对显式写入确认记录，再运行检查。

```sh
node scripts/doc-maintenance.mjs confirm --root /path/to/project --pair docs/guide.md --reviewed
node scripts/doc-maintenance.mjs check --root /path/to/project --files docs/guide.md
```

`--pair` 可以指 source、target 或 record。没有全库一键确认模式。`--reviewed` 是调用者完成内容核对的声明，不是工具对语义正确性的担保。检查命令不会为了通过而写确认记录。

## 章节与普通 Git 合并

记录以 source 的标题层次和 slug 路径作为稳定键，按相应位置配对两侧章节。两个分支修改不同章节时应只改变各自记录，使用普通 Git 文本合并即可。标题改名会改变键，同一章节并行修改仍可能冲突；先解决正文，再重新核对并确认。

不安装自定义合并驱动，不采用“选择我们的记录”掩盖冲突。Git 文本合并通过也不证明两个独立改动在语义上相容。

代码块及以下显式生成区块只有在两侧保持一致时才从语言内容摘要排除。普通正文即使碰巧相同，也仍然参与记录。

```html
<!-- doc-maintenance:generated:start api-table -->
Generated content shared verbatim by both languages.
<!-- doc-maintenance:generated:end api-table -->
```

两侧代码、生成区块不一致时，检查必须失败。元数据和未标记正文不能借生成标记随意免除评审。

## 找回上次确认的文本

```sh
node scripts/doc-maintenance.mjs brief --root /path/to/project --pair docs/guide.md --json
node scripts/doc-maintenance.mjs brief --root /path/to/project --pair docs/guide.md --base HEAD --json
```

`brief` 从已提交历史恢复与当前保存确认记录相符的配对，返回章节的两侧修改前后文本。显式 `--base` 也必须包含与该确认记录相符的内容。新配对或未提交的首次确认可能没有历史基准；此时报告缺口，agent 直接阅读并核对两侧，不编造“上次译文”。不写 Git 对象引用、不保存另一套隐式历史。

## 语义仍需核对

“必须”等于“可以”、漏掉例外、把超时单位译错，都可能在结构相同且错误确认后通过机械检查。遇到这类问题，要修内容和核对流程；不能声称哈希检查解决了语义审查。
