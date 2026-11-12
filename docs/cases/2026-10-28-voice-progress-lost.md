# 2026-10-28 · 语音包安装没有进度条（只显示“开始安装…”）

## 现象

- 0.6.19 用户点语音包「安装」后，卡片旁边只有一行小字「开始安装…」；
- 没有进度条、没有百分比，等了十几分钟不知道是在下载还是卡死。

## 根因

0.6.5 为了让「语音安装目录」改动立刻生效，把桥接的 `/api/voice/*` 改成**每个请求都新建**
`createVoicePacks(freshCfg)`：

```js
let freshCfg = cfg;
try { freshCfg = readConfigObject(...); } catch {}
const vp = createVoicePacks(freshCfg);   // ← 每个请求一个实例
```

而安装进度存在 **实例内部** 的 `activeInstalls` Map 里：

- POST `/install` 把任务塞进「这个请求的实例」，请求结束实例被 GC；
- 前端每 1.5 秒 GET `/api/voice/packs`，拿到的是**新实例**，`install` 字段永远 null；
- 前端于是只显示自己设的文案「开始安装…」，进度条条件 `p.install` 永不成立。

所以是**进度状态被请求生命周期吞掉**了，不是下载没开始。

## 修法（v0.6.20）

1. 桥接里把实例改成**按 `config.json` 的 mtime 缓存**（`getVoicePacksCached()`），
   声明在请求回调**外面**：既保留“改配置立刻生效”，又让 `activeInstalls` 跨请求存活；
2. 前端兜底：`busyId === p.id` 且还没有后端进度时，先显示**不确定态**进度条 + “正在启动安装…”，
   至少让用户看到“在动”。

## 验证

新增结构守卫 `test-voice-progress-instance.mjs`（已进 `npm test`）：

```
✅ vpCache 声明在请求回调**外面**
✅ 存在 getVoicePacksCached()
✅ 不要在每个请求里直接 createVoicePacks（进度会丢）
✅ 缓存 key 基于 config.json 的 mtime（保证热生效）
```

插件测试 0 失败，`test:audit` 77/77。

## 遗留

- 真实安装一次（含 1.84GB 分卷）确认进度条会随阶段变化，需要在用户机器上复测；
- 同类隐患：其他"每请求新建服务实例"的接口（若以后有）也会丢状态，review 时注意。
