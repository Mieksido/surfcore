# 2026-10-30 · 0.7.9 更新包 92 处哈希不符，自动更新仍 100% 失败

## 现象

0.7.9 用户点「立即更新」到 0.7.10 → 重启后仍是 0.7.9；`lastApplyFailure` 显示
`verify.staging-mismatch`，92 个文件哈希不符。

## 根因

清单生成时**哈希取自工作目录文件**，而发布物是 git 提交（tag 归档）：

- Windows 工作区是 CRLF；
- git 提交/GitHub 归档是 LF；
- 两边 sha256 必然不同 → 用户下载的 tag 归档校验恒失败。

0.7.9 只修了“文件集合”（gitignore 文件不进清单），没修“内容来源”。

## 修法

| 层 | 改动 |
| --- | --- |
| 清单生成 | 用 `git cat-file` 读 **HEAD 的 blob 字节**算 sha256，与归档逐字节一致；工作区 CRLF 不再影响 |
| 发版门禁 | 新增 `--verify-ref <ref>`：校验清单与某 ref 的内容完全一致，不一致 exit 1 |
| 同步 | 镜像同步白名单补 `.gitignore` 等 dotfile（漏同步同样会让清单对不上） |
| 客户端 | `verify.staging-mismatch` 标为**确定性失败**：原因带数量、hint 说明“发布侧问题、重试无效”，弹窗禁用「立即更新」并给手动下载 |
| 诊断 | `lastApplyFailure` 增加 `deterministic / mismatchCount / missingCount / sample` |

## 验证

```
node scripts/release-manifest.mjs --verify-ref HEAD
→ 清单 490 个，跟踪文件 490 个，问题 0 个
test-release-manifest：清单哈希 == git blob 哈希（抽查 .gitignore/README.en.md/docs/…）
test-update-apply-result：哈希不符 → deterministic + 数量 + 手动下载建议
```

## 教训

**清单必须由“将要发布的那份字节”生成**，不是“开发机上的文件”。CRLF 是最隐蔽的偏差来源。
