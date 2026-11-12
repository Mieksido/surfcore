# 2026-10-30 · 点更新反复失败，版本停在 0.7.5（verify.staging-mismatch）

## 现象

- 0.7.5（zip 安装、无 git）用户点「立即更新」，弹窗显示可更新到 v0.7.8；
- 每次只闪一条 4 秒 toast，版本始终不变；
- 没有 pending、没有更新助手进程、`apply-update.log` 从未被写过。

## 根因（开发端，两层）

1. **清单生成方式错**：`scripts/release-manifest.mjs` 扫的是**开发工作目录**，
   把 gitignore 掉的 `_backups/`（119 个）、`audio/`、`obs-diag.json` 和本地改过的 docs
   都算进了清单；用户下载的是 GitHub 归档，天然不可能包含这些文件。
2. **校验规则错**：`verifyStaging()` 要求清单里**每个**文件都必须存在且哈希一致 →
   对归档永远不成立 → 每次都在应用前失败（`verify.staging-mismatch`）。

附带问题：

- 下载用 `archive/refs/heads/main.zip`（分支会漂移，和“某版本的清单”必然错位）；
- 每次失败留下约 11.8 MB staging，从不清理；
- 失败只有 toast，弹窗内没有任何常驻说明。

## 修法

| 层 | 改动 |
| --- | --- |
| 发布制品 | `release-manifest.mjs` 只列 **git 跟踪文件**（`git ls-files`），工作区脏时直接报错退出 |
| 下载 | 有版本号时下载 **tag 归档**（`refs/tags/vX.Y.Z.zip`），没有版本号才退回 main |
| 校验 | 改成**交集校验**：只比包里真实存在的文件；缺失单独计数并记日志，不判失败 |
| 旧安装自愈 | 旧清单里出现“新包没有的路径”（脏清单特征）→ 用包内清单覆盖安装记录 |
| 失败可见 | `state.lastApplyFailure` 持久化；弹窗内常驻红块（code/原因/建议/复制诊断/去下载新版），toast 只作补充 |
| 磁盘 | 失败即删除本次 staging |
| 提交判定 | 按提交判定有更新时，用 `releases/latest` 的 302 补取版本号（显示与 tag 下载都需要） |

## 验证

- 新增 `test-release-manifest`：清单只含跟踪文件、无运行数据目录、版本与 package.json 一致；
- `test-update-apply-result` 新增：清单缺文件不判失败、tag 归档地址、失败清 staging、失败状态常驻；
- `npm run test:audit` 全绿；插件测试全绿。

## 遗留

- 已发布的历史版本（0.7.1–0.7.8）清单都是脏的：这些版本的 zip 用户**必须手动覆盖**一次到修复版；
- 下载包本身的 sha256/签名仍未做（当前是“包内文件与清单一致”）；列入后续。
