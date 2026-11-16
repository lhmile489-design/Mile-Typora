# testdata/docs

读取层的固定样本，供 `internal/docread`、`internal/pathguard` 与 `internal/service` 的测试使用。

| 文件 | 用来验证 |
| --- | --- |
| `plain.md` | 普通 UTF-8 文件、LF 换行 |
| `中文 与 空格.md` | 中文文件名、路径含空格（AC-08） |
| `bom.md` | UTF-8 BOM 去除且标记 `hasBom` |
| `crlf.md` | CRLF 识别为 `CRLF`，正文统一为 LF |
| `invalid-utf8.md` | 非 UTF-8 拒绝，错误码 `encoding` |
| `empty.md` | 空文件是有效文档（AC-07） |
| `UPPER.MD` | 扩展名大小写不敏感（AC-01） |

**`bom.md` 有意带 BOM，`invalid-utf8.md` 有意不是 UTF-8。** 全局编码检查会报这两个文件，这是预期结果，不要"修"它们；改它们会让对应测试失去意义。

超过 10 MiB 的文件、超大目录等样本不提交，测试在临时目录里生成（见 `docs/开发计划.md` §1.6）。
