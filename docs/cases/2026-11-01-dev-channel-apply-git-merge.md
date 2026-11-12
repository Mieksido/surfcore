# 2026-11-01 · dev 通道点更新报「spawn git ENOENT」

## 现象

测试机 0.8.6-dev.2（zip 安装、无 git）发现 dev.3 → 点「立即更新」→ 1 秒内失败：
`lastApplyFailure.code = apply.failed`，`reason = spawn git ENOENT`，`hint` 为空。

## 根因（多态字段只改了一半）

- `check()` 的 dev 分支返回 `channel: "dev"`；
- `apply()` 只匹配 `version / release / git` 三种 channel，dev 落到最后的兜底 `fastForwardComponent()`；
- 该兜底执行 `git merge --ff-only`，zip 机器没有 git → `spawn git ENOENT`；
- 失败对象只带 `error`，没有 `code/hint` → 记账回落 `apply.failed`、`hint` 为空。

## 修法

| 级别 | 改动 |
| --- | --- |
| P0 | `dev` 与 `version` 共用 `updateFromZip()`（tag 归档、清单校验、暂存、回滚全复用） |
| P0 | 未知 channel 明确返回 `apply.unknown-channel`（带 hint），只有“旧数据没有 channel”才允许 git 兜底 |
| P1 | git 失败补 `apply.git-failed`，ENOENT 明确提示“zip 安装不该走 git（插件缺陷）” |
| P1 | `not-available` / `blocked` 也补 code/hint，避免再次出现空 hint |
| P2 | helper 成功后删除外层 `staging/<id>-<stamp>/`（pkg.zip 不再残留）；`check()` 清理 3 天前的 staging |

## 验证

- `test-update-apply-result`：
  - dev 通道 → 下载 dev zip、成功排队，`code` 不再是 `apply.git-failed`；
  - 静态契约：unknown-channel 分支存在、只有旧数据走 git；
  - 3 天前 staging 会被清理；
- `npm run test:audit` 110/110；插件测试全绿。

## 残余

- dev 包约 12.5MB，慢网络仍可能触发 `download.timeout`（已有空闲超时 + 镜像回退）；
- 旧版本（dev.3 之前）没有这个修复，测试机需要先装一次 dev.4 才能自动更新；
- 更新器仍是 if 链而不是表驱动；这次加了 unknown 兜底，但下次再加 channel 仍要记得改两处。

## 同类漏洞收口（A–H，2026-11-01 一次性修完）

| # | 修复 |
| --- | --- |
| A | UI 正确显示 dev 通道：`v旧 → v新（测试通道）`，脚注“测试通道（Pre-release）”，不再当成 git / 显示 `undefined 个提交` |
| B | 更新助手校验 `kind`（只允许 zip / git）；未知 kind → `apply.unknown-kind`，不再默认 copyZip |
| C | 失败生命周期：失败时删 pending、只留 `.failed`；成功时清 `.failed`；新的排队（stageDeferredApply）先清旧 `.failed`；版本校验失败也删 pending |
| D | staging 清理跳过 `updates-pending.json` 正在引用的目录（待重启的包不会被 3 天清理误删） |
| E | `apply.unknown-channel / unknown-kind / git-failed` 也进 30 分钟退避，不再每次检查反复弹 |
| F | release 通道下载/安装失败补 `code/hint` |
| G | 更新进行中不允许切通道：`UPDATE_CHANNEL_BUSY`（409 + hint） |
| H | helper 等待超时/失败时清 `.started`，避免残留误判 |

## 验证（A–H）

- `test-update-apply-result`：
  - 失败后 pending 被删除；成功清旧 `.failed`；未知 kind 结构化失败；
  - 待重启 staging 不被清理，无引用的过期 staging 仍会清；
  - 原有 dev 通道/zip/版本排序用例全通过；
- `test-client-contract`：通道单选与文案；
- `npm run test:audit` 110/110；插件测试 0 失败。
