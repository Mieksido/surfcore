# 2026-11-06 · 点更新「跑了半天」后失败，再点提示「更新失败：原因不明」

## 现象

1. 设置页点「更新」→ 进度跑很久 → 失败；
2. 重启 DSH 再点 → 立刻弹 `✗ 更新失败：原因不明`。

## 取证

- `plugin.log`：

```text
11:43:30 [updates] 下载 https://codeload.github.com/.../v0.8.8-dev.7
11:50:31 [updates] 下载 https://codeload.github.com/.../v0.8.8-dev.7
（没有一条「下载完成」，也没有「下载失败」）
```

- `~/.dsh/surfcore/staging/`：

```text
surfcore-1793965410683/pkg.zip   3,657,192 B   ← 第一次，下到 3.6MB 卡死
surfcore-1793965831625/pkg.zip           0 B   ← 第二次，一个字节都没下来
surfcore-1793947417547/pkg.zip  10,118,631 B   ← 更早一次（成功过的）
```

- 网络：系统代理 `ProxyEnable=1 / 127.0.0.1:7897`，但 **7897 没有进程在听**；
  直连 `curl https://codeload.github.com/...` 返回 `000`（连不上）。→ 当前这台机器**没有可用外网**。

## 根因（两层）

### 第一层：下载确实失败了（环境）

更新走 `codeload.github.com` 的 tag 归档（13 MB）。没有外网 → 下载卡死/失败。
`staging` 里 3.6 MB 的残包就是"下到一半断了"，0 字节那个是"重试时一个字节都没拿到"。

### 第二层：「原因不明」是代码缺陷

`updates.apply()` 在**上一次还没结束**时返回：

```js
if (applying) return { ok: false, error: '正在更新中，请稍候', results: [] };
```

前端只读 `results[0]`：

```js
const failed = (r.results ?? []).filter((x) => !x.ok);
const f = failed[0] ?? {};
toast(`✗ 更新失败：${f.reason ?? f.error ?? "原因不明"}`);
```

`results` 是空数组 → `f = {}` → **顶层 `error`（"正在更新中，请稍候"）被完全忽略** →
用户看到「原因不明」。违反 AGENTS.md §1.7「失败必须可行动」。

而且第一次下载卡死后 `applying` 永远不复位（没有看门狗），后续点击全被这条 busy 挡住，
用户只能重启 DSH（重启后 flag 清零，但网络依旧不通，于是又卡一次）。

## 修法

1. `updates.js`：
   - busy 分支返回**结构化**对象：`code: 'apply.busy'` + `reason` + `hint` + `results: [busy]`；
   - 记录 `applyingSince`，超过 `APPLY_STUCK_MS`（10 分钟）自动复位并记一条日志，不再要求用户重启；
   - `finally` 里同时复位 `applyingSince`。
2. `client.js`：`results` 为空时回落到顶层 `r.error / r.reason / r.code`，不再输出「原因不明」。

## 影响面

- 只影响更新流程的错误展示与锁释放，不改变下载/校验/暂存/回滚任何一步；
- 不碰用户数据与密钥。

## 验证

```powershell
node scripts/test-session-rollover.mjs   # 177 项（新增 busy/回落/保留弹窗断言）
npm run test:audit                       # 152/152（合并后已重生成清单）
```

新增断言：`applyingSince` / `APPLY_STUCK_MS` / `apply.busy` / `results:[busy]` /
`reason` / `hint` / 前端回落顶层 error。

## 回滚

删除 busy 分支的结构化返回与 `applyingSince` 相关行、恢复前端一行即可；无持久化影响。

## 残余

- **本机没有可用外网**（代理未启动）这件事，代码修不了：修完后用户会看到
  「上一次更新还没结束（可能卡在下载）」，而不是「原因不明」；
  真正要更新，得先把代理软件打开（`127.0.0.1:7897`）。
- 建议后续给 `fetch` 支持系统代理（Node 原生 fetch 默认不走系统代理），否则
  "浏览器能开 GitHub、更新器不能"会反复发生。
