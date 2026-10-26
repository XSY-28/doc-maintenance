---
title: Sample guide
kind: tutorial
---
# Sample guide

English | [中文](guide.zh.md)

## Purpose

This sample keeps a configuration reference synchronized with its source. Read the [configuration reference](reference.md) for available settings.

## Check the reference

Run the command in this directory. Success prints that the reference matches its source; a stale table exits unsuccessfully.

```sh
node project-check.mjs check
```

## Update a setting

Change the default in `settings.json`, then regenerate the reference. Review the change before accepting it.

```sh
node project-check.mjs --write
```

Regeneration updates `reference.md`. It does not confirm a translation or modify Git configuration.
