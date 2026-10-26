---
title: 示例指南
kind: tutorial
---
# 示例指南

[English](guide.md) | 中文

## 用途

本示例让配置参考表与来源保持同步。可用配置见[配置参考](reference.md)。

## 检查参考表

在本目录运行以下命令。成功时会输出参考表与来源一致；表格过期时以失败状态退出。

```sh
node project-check.mjs check
```

## 修改配置

修改 `settings.json` 中的默认值，然后重新生成参考表。接受修改前先查看变动内容。

```sh
node project-check.mjs --write
```

重新生成会更新 `reference.md`，不会确认翻译或修改 Git 配置。
