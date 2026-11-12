# C 系列 r3 回执审阅

> 2026-11-08 · 开发机
> bundle：`surfcore-c-opt-2026-11-08-r3.bundle`
> HEAD：`f4d7809`
> 基线：`669beb8`
> 方式：只读检查 bundle / 分支 / 测试，**没有合并、没有修改工作区**。

---

## 0. 结论

r3 修掉了 6 条审阅项，方向和执行都对，**但不是“P0 只剩工单”的状态**：

- `readPatch` 现在会抛错，但调用它的 `/provider` API **没有接住**，可能直接 500；这不是结构化报错；
- 只有 BEGIN 没有 END 的修复只覆盖了 `removeProvider`，**`upsertProvider` 仍会写坏/重复区块**；
- `.env` 只拒绝了换行，**`#`、空格、引号等 dotenv 特殊值还没处理**；
- 两文件事务、冲突 YAML 解析、YAML 预校验、checksum 完整性、zip 清理、B站场景、直连 TTS UI **都还没做**；
- 交付说明里“已把 C5 文案改成去全部参数配置”与实际代码不符：`client.js:6015` 仍写“设置 → 语音 → 直连服务商”。

**结论：r3 可以继续做，但仍不建议整包合 dev/main。**

---

## 1. r3 实际改了什么

从 `8d4c433` 到 `f4d7809`：

| 文件 | 变化 |
|---|---|
| `src/dsh-provider-patch.js` | 读失败抛错；缺 END 时 `removeProvider` 拒绝 |
| `src/provider-env.js` | 拒绝换行；`.env` 备份保留 5 份 |
| `plugins/surfcore/lib/store.js` | 直连 TTS `apiKey` 加入 `SECRET_PATHS` |
| `scripts/test-scene-models.mjs` | 场景表改回 `qq/bili/pet/other` |
| `scripts/test-dsh-provider-patch.mjs` | 增加 2 项缺 END 断言 |

测试机自测：

```text
test-dsh-provider-patch    30/30
test-provider-env           20/20
test-provider-ui            12/12
test-secret-store           12/12
test-scene-models           11/11
test-voice-import-checksum   6/6
test-voice-direct-tts       12/12
test-voice-pack-import       9/9
```

我复跑结果一致：**103 项通过**。

---

## 2. 已修项核对

### 2.1 P1-9 场景测试不同步：已修

`test-scene-models` 现在只期待：

```text
qq / bili / pet / other
```

`11/11` 通过。  
交接里“112 项全过”的口径仍不对（实际是 103 项新增测试；之前的 112 包含已存在测试），但这条本身已经修好。

### 2.2 P0-3 读失败当空文件：修了一半

`readPatch` 现在：

- `ENOENT` → 空；
- 权限/占用/IO → 抛 `provider.patch.unreadable`。

代码级正确，但 **调用方没有接住**：

- `handleProvider` 的 GET `providerStatus()`；
- apply 的 `upsertProvider()`；
- clear 的 `removeProvider()`。

这三个都可能把异常抛到 Web 请求层，变成 500/连接断开，而不是：

```json
{ "ok": false, "code": "provider.patch.unreadable", "error": "...", "hint": "..." }
```

**需要**：`handleProvider` 外面统一 try/catch，把 `err.code` / `err.hint` 映射成结构化 JSON。

### 2.3 P0-4 缺 END 截断：只修了 remove，upsert 仍有洞

`removeProvider` 现在：

```js
if (!before.includes(BLOCK_END)) return { code: 'provider.patch.block-corrupt' }
```

这是对的。

但 `upsertProvider` 仍然：

```js
const before = readPatch(dir);
const conflict = stripBlock(before)...;
const next = composePatch(before, block);
```

如果文件里有 `BLOCK_BEGIN` 但没有 `BLOCK_END`：

- `stripBlock` 返回原文（r3 的改法）；
- 冲突检测可能漏；
- `composePatch` 在原文后**再拼一个 BEGIN/END**；
- 文件里出现两个 BEGIN 或畸形区块。

**需要**：`upsertProvider` 也先检查 END；缺 END 直接返回 `provider.patch.block-corrupt`，不写文件。

### 2.4 P0-5 `.env` 值校验：只拒绝换行

r3 代码：

```js
if (/[\r\n]/.test(raw)) throw provider.env.invalid-value;
```

注释写“`#` 开头的值会被 dotenv 当注释”，但代码没有拒绝/转义 `#`。

还需要处理：

- 前导/尾随空格；
- 双引号/单引号；
- `#`；
- `\`；
- 非 ASCII 控制字符；
- 以 `=` 开头的值。

**建议**：按 dotenv 规则序列化（需要时加引号并转义），或直接拒绝这些字符并给 `provider.env.invalid-value`。

### 2.5 P0-6 `.env` 备份无限增长：已修

保留最近 5 份，和 profile 备份一致。

但备份仍是**明文 key**；需要权限收紧/提醒，不能只靠数量限制。

### 2.6 P0-8 直连 TTS key 脱敏：已修

`SECRET_PATHS` 已加入：

```text
socialV2.voice.tts.direct.apiKey
```

`/config` 不会再回明文。  
但 key 仍明文存在 `config.json` 和 `.env`，这是设计限制，UI 已提示。

---

## 3. 仍未修的高风险项

### P0-1：profile + `.env` 两文件事务

`handleProvider` 仍然是：

```text
apply：先写 .env → 再写 patch
clear：先删 .env → 再删 patch
```

如果 patch 冲突/写失败：

- `.env` 已经被改；
- 用户只看到 `provider.conflict`；
- 下次 DSH 启动可能用错 key。

**这是当前最高优先级。**

验收：

1. 故意让 patch 冲突 → `.env` 必须逐字节不变；
2. 故意让 `.env` 写入失败 → patch 不动；
3. clear 失败 → 两边都恢复。

### P0-2：冲突检测还是按行匹配

`src/dsh-provider-patch.js:147-149` 仍然只认：

```yaml
- id: llm-deepseek
```

不认：

```yaml
- id: 'llm-deepseek'
- id: "llm-deepseek"
  - id: llm-deepseek   # insert 里
```

**需要**：`yaml.load` 后遍历（含 `insert` / override），按 id 比对。

### P0-7：YAML 预校验 / DSH 启动验证

仍未做：

- 写前解析生成结果；
- 非法 YAML → `provider.patch.parse-failed`；
- 写后 DSH 起不来 → 自动恢复/明确提示。

### P1：checksum 完整性

`verifyChecksums` 仍只校验清单列出的文件：

- 清单只写一个文件也会 `ok:true`；
- `inspectImport` 仍会把它当 `verified:true`；
- 没有 `listed / total / coverage`。

**这是“假安全感”，建议下一批先修。**

### P1：checksum 路径穿越 / 文件名匹配

- `path.join(dir, row.rel)` 没有 `path.resolve` 前缀检查；
- checksum 文件仍取第一个 `*.sha256.txt`，不按包名匹配。

### P1：zip 临时目录/空间/超时

`inspectImportZip` 仍未：

- `try/finally` 清理 `state/voice-import-tmp/<ts>`；
- 解压前检查磁盘；
- 限制 zip 大小/解压后大小；
- 给 `Expand-Archive` 超时/取消。

### P1：B站场景模型静默不生效

仍未接 scheduler，也没有禁用 B站选项。  
UI 选了模型，B站实际可能仍用全局模型，且无提示。

### P1：直连 TTS 没有 UI

`client.js` 仍没有：

- provider / apiKey / groupId / voiceId / model 输入；
- 试听。

`client.js:6015` 仍写：

> 设置 → 语音 → 直连服务商

但该入口不存在。  
交付说明说“已把文案改成去全部参数配置”，**与代码不符**。

### P1：测试仍没覆盖新修的风险

- `test-dsh-provider-patch` 没有测 `upsertProvider` 遇到缺 END；
- `test-provider-env` 没有测 `#`/空格/引号值；
- 没有测 `readPatch` 权限错误后的 API 响应；
- 没有测 profile + `.env` 事务回滚。

---

## 4. 报错闸门分析（r3）

### 现在能报的

| 场景 | code | 有 hint |
|---|---|---|
| 读 profile 失败 | `provider.patch.unreadable`（抛出） | 有 message，无统一 JSON |
| 缺 END（remove） | `provider.patch.block-corrupt` | 有 |
| `.env` 换行 | `provider.env.invalid-value` | 无 hint（需补） |
| 同 id 冲突 | `provider.conflict` | 有 |
| 探活 401/403/404/超时 | `provider.probe-*` | 有 |
| checksum 不匹配 | `IMPORT_CHECKSUM_MISMATCH` | 有 |
| zip 解压失败 | `IMPORT_UNZIP_FAILED` | 有 |
| 直连 TTS 错误 | `tts.direct-*` | 有 |

### 仍会静默/变成 500 的

1. **`readPatch` 抛错后 API 没接**：GET/apply/clear 都可能 500。
2. **`upsertProvider` 缺 END**：可能写坏文件。
3. **`.env` `#`/空格值**：写坏但无 code。
4. **B站场景不生效**：无 code。
5. **checksum 部分清单**：显示“已验证”，无警告。
6. **zip 临时残留**：无提示。
7. **C5 没有 UI**：用户走不到错误。
8. **`provider.apply.partial` / `provider.rollback-failed`**：不存在。
9. **`provider.patch.parse-failed`**：不存在。

### 建议的错误契约

```json
{
  "ok": false,
  "code": "provider.apply.partial",
  "error": "profile 写入失败，key 已恢复",
  "hint": "点「恢复备份」或手动还原；本次没有生效",
  "detail": { "backup": "...", "envRestored": true }
}
```

每个错误至少要有：

- `code`
- `error`
- `hint`
- 用户可点的下一步：重试 / 恢复备份 / 去设置 / 看日志

---

## 5. 建议 r4 的顺序

### 第 1 批（必须）

1. `handleProvider` 统一 try/catch：`provider.patch.unreadable` → 409/500 JSON；
2. `upsertProvider` 缺 END 也拒绝；
3. `.env` 值按 dotenv 规则校验/转义；
4. `applyProviderConfig` 两文件事务 + rollback；
5. YAML `load` 预校验。

### 第 2 批（C6）

6. checksum `listed/total/coverage`；
7. `path.resolve` 防穿越；
8. 按包名匹配 checksum；
9. zip 清理/空间/超时；
10. 补测试：部分清单、路径穿越、缺 END upsert、`.env` 特殊值、读失败 API。

### 第 3 批（C5/C4）

11. 直连 TTS 专用 UI 或明确“仅配置文件”；
12. B站 scheduler 接入或禁用；
13. 模型存在性校验 / 上下文提示。

---

## 6. 一句话

**r3 是有效修复，但“P0 已修”只对 6 条中的一部分成立；真正的 P0（两文件事务、读错误结构化、缺 END 的 upsert、dotenv 值）还在。**

建议继续按工单做，先不要合 main。
