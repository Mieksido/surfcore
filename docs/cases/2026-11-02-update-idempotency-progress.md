# 更新完成又提示更新 + 进度条只闪一下网速

日期：2026-11-02

## 1. 现象

- 测试机点「立即更新」，文件下载完成/排队后，又弹「有可用更新」；
- 预期应该是「更新已下载，请重启 DSH」；
- 更新进度条只短暂显示网速/百分比，随后变成无进度、无网速的转圈条；
- 下载很快时甚至一次网速都看不到。

## 2. 根因

### 2.1 staged 后 dismiss 键被写成 `vnull`

`apply()` 最后先做：

```js
await check({ fetch: false });
```

而 `inspectVersionComponent({fetch:false})` 返回：

```js
latestVersion: null,
updateAvailable: false,
```

随后 staged 分支用这份结果算目标键：

```js
const key = report?.remote ?? `v${report?.latestVersion ?? ''}`;
```

于是写入：

```text
dismissed[component] = "vnull"
```

下一次真实 check 的键是：

```text
v0.8.6-dev.N
```

对不上，`pendingOf()` 继续把同一更新当 pending，重启前又弹。

### 2.2 弹窗内更新完没有重启提示

概览卡片更新路径会 `setRestartHint({staged:true})`；  
`UpdatesModal` 的 `applySelected` 只 toast，不设置重启提示，导致用户只看到弹窗消失，随后又看到更新提示。

### 2.3 进度只覆盖下载 body

`downloadProgress` 只在下载循环里 `active:true`；下载完成后立刻：

```js
active: false
```

解压、校验、备份、排队都没有 phase/统计；UI 又只看 `dl.active`，于是退回不确定进度条。

快速下载时 1 秒轮询可能完全错过 active 阶段。

## 3. 修法

- staged 目标键在下载前捕获，不再从 `check({fetch:false})` 算；
- staged 不再做 no-fetch 全量检查；只有真正落地的组件才重新 fetch；
- `pendingOf()` 读取 `updates-pending.json`：排队中的组件在重启前不再算 pending，兼容旧 `vnull`；
- 弹窗内 staged 完成时调用 `onStaged`，弹「更新已下载：重启 DSH 后生效」；
- `checkUpdates()` 看到 `lastApply.status=pending_restart` 时提示重启，而不是“已是最新”/再次更新；
- `downloadProgress` 增加阶段：download / extract / verify / backup / install / pending / failed；
- 下载完成后保留 bytes/total/percent/speed；UI 在解压阶段仍显示下载统计，只把进度条设为不确定；
- 轮询从 1s 缩到 500ms，开始时立即拉一次，结束时再拉一次；
- release 通道的 `downloadTo` 也支持 progress 回调。

## 4. 生效/风险

- 重启 DSH 后生效；
- queued 组件重启前不会重复弹更新，但仍保留 `lastApply=pending_restart` 提示；
- 如果 helper 失败，`.failed` 会出现，仍应显示失败而不是永久隐藏；
- 解压阶段没有真正字节进度，只能显示阶段 + 已下载统计；
- 进度回调增加频率，但只在 apply 期间轮询；
- 没有真实网络慢速 live 测试，使用本地更新回归/源码契约覆盖。

## 5. 验证

```text
node plugins/surfcore/scripts/test-updates.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
