# doc-maintenance

English | [中文](README.md)

I've been reading the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) repository. I was curious about how they keep their Chinese and English documentation in sync, so I looked through the relevant docs and commits. A few practices seemed worth borrowing:

- Give each kind of document a clear job. Keep the main explanation of a fact in one place and link to it elsewhere, so there are fewer copies to maintain.
- Set length limits for files that tend to keep growing, such as `AGENTS.md` and architecture overviews. When a file gets too long, first check whether some of the content belongs somewhere else, then look for ways to shorten it.
- Either language can be written first. Record the content when both versions have been checked, then work on the parts that changed next time. Keep the wording that has already been polished.
- Use approved examples and agreed terminology to keep the writing consistent. When shortening text, preserve conditions, exceptions, and what happens when something fails.
- Let scripts check what they can: links, code blocks, and bilingual records, for example. Checking whether the meaning has changed still requires looking at the source.

I put these practices into **doc-maintenance**, a Skill for coding agents with a few checking scripts. It can help tidy up a README, update docs after code changes, or maintain Chinese and English versions. It works with a project's existing writing conventions and tools; bilingual checks and length budgets can be enabled as needed.

The commits and contributors I drew from are listed in [NOTICE.md](NOTICE.md). This is my own implementation based on DSH's approach.

## Usage

You'll need Node.js 22 or later. Clone the repository and install its dependencies:

```sh
git clone https://github.com/XSY-28/doc-maintenance.git
cd doc-maintenance
npm ci --ignore-scripts
```

Place the complete directory in a Skill directory supported by your coding agent. The entry point is [SKILL.md](SKILL.md). Keep the accompanying scripts and references rather than copying just that file.

Then give your agent a task such as:

> Use doc-maintenance to update the docs for these code changes, synchronize the Chinese and English versions, and leave unrelated content alone.

You can also try the included example first:

```sh
node scripts/doc-maintenance.mjs check --root examples/minimal
node scripts/doc-maintenance.mjs run generated --root examples/minimal
```

There are four commands: `check` checks the docs, `confirm` records bilingual content after review, `brief` finds the before-and-after text in Git history, and `run` executes a check configured by the project. `check` is read-only: it does not edit documents or refresh confirmation records.

See the [check reference](references/checks.md) for configuration and command usage, and the [bilingual reference](references/bilingual.md) for maintaining both languages.

## Verification

```sh
npm test
npm run check
```

So far, this has been verified on macOS with Node.js 24. Other platforms haven't been tested yet, and the scripts don't replace a review of the content.

[MIT License](LICENSE)
