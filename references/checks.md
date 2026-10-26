# 配置和命令

## 项目配置

项目根目录可选 `.doc-maintenance.json`。没有配置时，检查 Markdown 本地引用；默认跳过 `node_modules/`、`.git/`、`work/`、`dist/` 和 `coverage/`。配置中的 `exclude` 追加到这些默认排除项。

```json
{
  "documents": ["README.md", "docs/**/*.md"],
  "exclude": ["docs/archive/**"],
  "budgets": [{"path": "README.md", "unit": "characters", "limit": 4000}],
  "pairs": [{"source": "docs/guide.md", "target": "docs/guide.zh.md", "record": "docs/guide.i18n.yaml"}],
  "commands": {
    "docs": {"argv": ["npm", "run", "docs:check"], "description": "项目已有文档构建", "timeoutMs": 120000}
  }
}
```

路径为仓库内 POSIX 相对路径，禁止 `..`、绝对路径、路径逃逸或重复配对路径。`documents`/`exclude` 接受正向 glob；不使用 `!` 否定模式。未知配置字段会报错。预算必须显式选择 `words` 或 `characters`，上限为正整数。

双语范围由 `pairs` 显式指定；未列出的双语文件不会自动获得配对保证。新增双语文档时，在同一修改中增加配置及三份文件。配对检查以配置为准，不因 `documents` 排除它而跳过已配置的配对。

## 检查

在工具目录使用相对脚本路径，其他位置请使用工具的绝对路径：

```sh
node scripts/doc-maintenance.mjs check --root /path/to/project --json
node scripts/doc-maintenance.mjs check --root /path/to/project --files README.md docs/guide.md
node scripts/doc-maintenance.mjs check --root /path/to/project --changed HEAD
node scripts/doc-maintenance.mjs check --root /path/to/project --staged
```

`--files`、`--changed`、`--staged` 三者互斥。`--changed REF` 选出工作区相对 Git ref 的变化及未跟踪文件；`--staged` 选出暂存变化，并从暂存区读取配置、正文、链接目标和记录，绝不拿磁盘上的修复补足索引。Git 操作模式要求 `--root` 是仓库根目录；冲突未解决时拒绝假装可验证。

选择配对的任一文件时，两侧一起检查。链接仍扫描配置范围内的入链，以发现被选中的删除或移动目标；预算与双语检查按选择范围执行。配置本身变化时扩大为全量检查。结果的 `input`、`scope`、`selected` 和 `filesChecked` 说明真正检查了什么，局部通过不代表全库通过。

本地链接检查支持 Markdown 普通/引用链接、图片、GitHub 风格标题锚点及显式 HTML id/name。根路径 `/docs/a.md` 按项目根目录解释，不作为文档网站路由。站点专用路由用实际站点构建验证。外部 URL 不发网络请求，非 Markdown 文件的 fragment 不验证。Markdown 扩展如 MDX、Obsidian wikilinks、插件自动锚点需要项目自己的检查。

所有检查只读，不自动翻译、写预算、生成目录或重新确认。结构与链接错误不会因为是现存旧问题而自动忽略；缩小范围时会如实报告范围。

## 确认与变更简报

详见 [bilingual.md](bilingual.md)。`confirm` 是显式写操作，需先完成内容核对。`brief` 只提供两侧前后文本，不自动挑选正确版本。

## 运行项目已有命令

```sh
node scripts/doc-maintenance.mjs run docs --root /path/to/project --json
```

只执行指定名称的 `argv`，工作目录为项目根目录，不经过 shell。命令不存在、非零退出或超时会失败，输出包含实际 exitCode、stdout/stderr 和耗时。默认超时 120 秒，可配置 1–3600000 毫秒；输出分别最多保留约 1 MiB，并标记截断。

`check` 不会自动运行这些命令。运行前读懂项目命令与副作用；不应把不可信仓库的命令自动当作授权。Windows 下 `.cmd`/shell 脚本的执行方式需显式配置并实机验证，不能把 macOS 上通过说成跨平台通过。

## 接入 Git 与 CI

项目已有 hook 可以调用 `check --staged`；本工具不安装 hook、不修改 Git 配置。CI 在完整检出的候选版本运行无范围的 `check`，再显式调用项目需要的生成检查、示例测试和构建。重用相同脚本，不在 CI 里复制另一套规则。

退出码：0 表示已执行的检查通过；1 表示检查或项目命令失败；2 表示用法、配置或操作错误。JSON 错误包含 code、path、可用时的 line 和解释。安装错误（例如依赖尚未安装）可能由 Node.js 在 CLI 启动前报告。
