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
