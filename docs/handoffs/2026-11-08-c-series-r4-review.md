# C 系列 r4 回执复核

> 2026-11-08 · 开发机
> bundle：`surfcore-c-opt-2026-11-08-r4.bundle`
> HEAD：`0382058`
> 基线：`669beb8`
> 方式：只读检查 bundle / 分支 / 测试，**没有合并、没有修改工作区**。

---

## 0. 结论

r4 把上一轮指出的 4 条修掉了，且 `upsertProvider` 缺 END 这条是真的修好了。

但还有 **1 个新的报错回归**：

- `.env` 值校验抛出的 `provider.env.invalid-value` 被 `writeEnvSecret()` 的 catch **吞掉并替换成通用提示**；
- 用户填了含 `#`/引号的 key，会看到“环境变量名只能字母/数字/下划线”，**诊断方向完全错了**；
- API 也没有把这个 code 透传出来。

其余未修项和 r3 一致：

- 两文件事务；
- 冲突检测改 YAML；
- YAML 预校验；
- checksum 完整性 / 路径穿越 / 文件名匹配；
- zip 临时目录 / 空间 / 超时；
- B站场景；
- 直连 TTS UI。

**r4 可以继续，但仍不能整包合 dev/main。**

---

## 1. r4 实际改了什么

`HEAD 0382058` 相对 r3：

| 文件 | 变化 |
|---|---|
| `plugins/surfcore/lib/index.js` | `/provider` 路由统一 try/catch，`unreadable` 返回 409，其它 500 |
| `src/dsh-provider-patch.js` | `upsertProvider` 遇到缺 END 拒绝写 |
| `src/provider-env.js` | 拒绝换行、控制字符、首尾空格、`# " ' \` |
| `plugins/surfcore/lib/client.js` | 直连 TTS 文案改为“去全部参数” |
| `scripts/test-dsh-provider-patch.mjs` | 新增 2 项 upsert 残缺断言 |

测试结果（我复跑）：

```text
test-dsh-provider-patch    32/32
test-provider-env          20/20
test-provider-ui           12/12
test-scene-models          11/11
test-secret-store          12/12
test-voice-import-checksum  6/6
test-voice-direct-tts      12/12
test-voice-pack-import      9/9
```

---

## 2. 已修项核对

### 2.1 P0-3 后半：`/provider` 不再裸 500

`/provider` 路由现在：

```js
try { await handleProvider(req, res); }
catch (e) { json(res, code === 'provider.patch.unreadable' ? 409 : 500, { ok:false, code, error, hint }); }
```

方向正确。  
但 `provider.env.invalid-value` 目前不会走到这里（见 §3），所以这条只解决了 profile 读失败。

### 2.2 P0-4 后半：upsert 缺 END 拒绝

`upsertProvider` 开头新增：

```js
if (hasBlock(before) && !before.includes(BLOCK_END)) {
  return { ok:false, code:'provider.patch.block-corrupt', ... }
}
```

这条是实修，文件不会动。

### 2.3 P0-5 后半：`.env` 保留字符拒绝

现在拒绝：

- 换行；
- 控制字符；
- 首尾空格；
- `# " ' \`。

但错误在 `writeEnvSecret()` 里被吞（见 §3），**用户看到的提示是错的**。

### 2.4 P1 直连文案：不再骗人

`client.js:6015` 已改为：

> 直连服务商还没有专用卡片：到「全部参数」里改 socialV2.voice.tts.direct...

这条修好了。

但 `client.js:6011` 仍写着：

> MiniMax、阿里 CosyVoice 等正在接入

后端已经支持，UI 仍说“正在接入”，仍然不一致；而且用户没有专用卡片，只能手改全部参数。功能上仍是未完成状态。

---

## 3. 新发现的回归：`.env` 校验错误被吞掉

`src/provider-env.js` 的 `writeEnvSecret()`：

```js
try {
  next = setEnvValue(before, key, secret);
} catch (e) {
  return {
    ok: false,
    error: String(e?.message || e),
    hint: '环境变量名只能字母/数字/下划线，且不能以数字开头'
  };
}
```

问题：

- `setEnvValue` 抛的是 `provider.env.invalid-value`（key 含 `#`/引号/空格/控制字符）；
- 这里没有透传 `e.code`；
- `hint` 被替换成“环境变量名非法”，完全误导；
- API `handleProvider` 收到 `{ok:false,error,hint}`，会包成 `provider.env`，用户看到的是错误建议。

正确行为：

```json
{
  "ok": false,
  "code": "provider.env.invalid-value",
  "error": "key 里含有 .env 保留字符（# 引号 反斜杠）",
  "hint": ".env 会把这些字符当语法；请确认 key 是否复制错"
}
```

**这是报错闸门的回归，必须修。**

另外 `test-provider-env` 仍是 20 项，没有覆盖新增的 `#`/控制字符/首尾空格分支；所以测试全绿不代表这条可用。

---

## 4. 仍未修（与 r3 相同）

### P0-1：两文件事务

`handleProvider` 仍然：

```text
apply：先写 .env → 再写 patch
clear：先删 .env → 再删 patch
```

patch 失败时 `.env` 已改；clear 失败时 key 已删。  
这是最高优先级。

### P0-2：冲突检测仍按行匹配

`src/dsh-provider-patch.js` 仍只认：

```yaml
- id: llm-deepseek
```

不认引号、缩进、`insert:` 内的 id。  
用户已有 provider 时仍可能被覆盖。

### P0-7：YAML 预校验 / DSH 启动验证

未做：

- 写前 `yaml.load`；
- 写后 DSH 启动健康检查；
- 启动失败恢复。

### P1：checksum 覆盖完整性

`verifyChecksums` 仍会：

- 清单只列一个文件 → `verified:true`；
- 没有 `listed/total/coverage`；
- 路径 `path.join(dir, rel)` 仍可 `../` 越界；
- checksum 文件仍取第一个 `*.sha256.txt`，不按包名匹配。

### P1：zip 临时目录 / 空间 / 超时

`inspectImportZip` 仍未：

- `try/finally` 清理 `state/voice-import-tmp/<ts>`；
- 解压前检查磁盘；
- 限制 zip/解压后大小；
- 给 `Expand-Archive` 超时/取消。

### P1：B站场景模型

仍未接 scheduler，也未禁用 B站选项。  
UI 选了模型，B站可能仍用全局模型，且无提示。

### P1：直连 TTS 专用 UI

仍未做；用户只能改 `全部参数`。  
文案已经诚实，但功能未完成。

### P1：测试覆盖

- 没有 `provider.env.invalid-value` 的测试；
- 没有 `/provider` 读失败返回 JSON 的测试；
- 没有事务回滚测试；
- 没有 checksum 部分清单/路径穿越测试。

---

## 5. 报错闸门现状

### 现在有

| 场景 | code | 备注 |
|---|---|---|
| profile 读失败 | `provider.patch.unreadable` | API 现在 409 JSON |
| 缺 END | `provider.patch.block-corrupt` | upsert/remove 都拒绝 |
| key 非法 | `provider.env.invalid-value` | **被 writeEnvSecret 吞掉，未到 API** |
| 同 id 冲突 | `provider.conflict` | 仍按行匹配 |
| 探活失败 | `provider.probe-*` | 有 hint |
| checksum 不匹配 | `IMPORT_CHECKSUM_MISMATCH` | 有 hint |
| zip 解压失败 | `IMPORT_UNZIP_FAILED` | 有 hint |
| 直连 TTS | `tts.direct-*` | 有 hint |

### 仍静默/不清楚的

1. `.env` 非法值 → 错提示；
2. 两文件事务失败 → 没有 `provider.apply.partial`；
3. B站场景不生效 → 没有 `models.scene-unsupported`；
4. checksum 部分清单 → 显示“已验证”，没有 `import.checksum-incomplete`；
5. zip 临时目录残留 → 没有清理提示；
6. YAML 预校验失败 → 没有 `provider.patch.parse-failed`；
7. 直连 TTS 无 UI → 用户只能改全部参数，没有专用错误面。

### 建议补的 code

- `provider.apply.partial`
- `provider.rollback-failed`
- `provider.patch.parse-failed`
- `provider.env.invalid-value`（透传）
- `models.scene-unsupported`
- `import.checksum-incomplete`
- `import.checksum-path-invalid`
- `import.staging-cleanup-failed`

每个都要 `code + error + hint + detail`，UI 显示可操作建议。

---

## 6. r5 建议顺序

1. **`provider.env.invalid-value` 透传**（小改，但当前用户提示是错的）；
2. **两文件事务 + rollback**（最高风险）；
3. **冲突检测改 YAML 解析**；
4. **YAML 预校验 + DSH 启动验证**；
5. **checksum 完整性 + 路径安全 + 文件名匹配**；
6. **zip 清理/空间/超时**；
7. **B站 scheduler 接入或禁用**；
8. **直连 TTS 专用卡片**。

---

## 7. 一句话

**r4 的 4 条是真的修了，`upsertProvider` 缺 END 也补上了；但 `.env` 的非法值提示被 catch 吞掉，是一个新的报错回归，必须先修。**

其余 P0/P1 还没动，尤其是两文件事务、冲突 YAML、checksum 完整性和 B站场景；不建议现在合 main。
