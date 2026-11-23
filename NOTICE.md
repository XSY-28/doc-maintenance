# 来源与归属

这是独立实现的文档维护 Skill 工具包，方法受到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 文档工程实践启发，不是 DeepSeek 官方工具。本实现未复制 DSH 程序源码。

主要参考包括：

- [文档分层与预算](https://github.com/deepseek-ai/deepseek-harness/commit/aa36b3b36bcb46ef3c9d37b23c3145439fd7bf1a)：Tianyi Cui。
- [双语同权配对](https://github.com/deepseek-ai/deepseek-harness/commit/ec05295a0cb1f3a990528a17495da858e0394db5)与[人工校准样例](https://github.com/deepseek-ai/deepseek-harness/commit/abb145d99f74ac3635f1c00c89b02eb57149d42b)：ZiyaZhang；后续提交采纳了 jingtingxiang 的术语和译文校准。
- [日常翻译减负](https://github.com/deepseek-ai/deepseek-harness/commit/c5dd99124cb0caee32ddd3f1856860ecb4acd149)：Tianyi Cui。
- [读者导向文档标准](https://github.com/deepseek-ai/deepseek-harness/commit/0b5eba0c8d59e8310cd0050a21832c5840ee0cfb)：Magolor。
- [章节级记录替代合并驱动](https://github.com/deepseek-ai/deepseek-harness/commit/e7def469e1390891cc45f78bea4063009abf6edd)：Turtle。
- [思维链泄漏清理](https://github.com/deepseek-ai/deepseek-harness/commit/05a4a41f4fd7445eaeef6cdd966d6550f2322be9)、[决策记录归档清理](https://github.com/deepseek-ai/deepseek-harness/commit/37140bf823914a0cb30a2f8efe50e1456a81ac7e)、[仓库引用约束](https://github.com/deepseek-ai/deepseek-harness/commit/6b651380a7afd2a8ece5df3ef166e3a6a8388b2a)与[段落换行约束](https://github.com/deepseek-ai/deepseek-harness/commit/67447fcdc31fd3779b7a5b625b25ad75951da304)：Tianyi Cui。

这里保留方法与适用条件，不移植 DSH 的包目录、固定词数、必需栏目或自定义 Git 驱动。DSH 采用 MIT 许可；未来如直接复制其代码或文档实质部分，应同时保留其版权和许可声明。本工具依赖的 npm 包各自保留其许可证，具体版本见 npm-shrinkwrap.json。
