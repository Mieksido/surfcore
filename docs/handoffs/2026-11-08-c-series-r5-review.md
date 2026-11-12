# C 系列 r5 回执复核

> 2026-11-08 · 开发机
> bundle：`surfcore-c-opt-2026-11-08-r5.bundle`
> HEAD：`9e1e5ff`
> 基线：`669beb8`
> 方式：只读检查 bundle / 分支 / 测试，**没有合并、没有修改工作区**。

---

## 0. 结论

r5 修好了 r4 的 `.env` 报错回归，模块层是对的：

- `writeEnvSecret()` 现在会透传 `provider.env.invalid-value`；
- 空格一律拒绝；
- 文案改成“后端已支持，入口在全部参数”。

但 **API 层又把 code 改回去了**：

```js
if (!envResult.ok) {
  json(res, 400, { code: 'provider.env', ... })
}
```

`handleProvider` 对 `writeEnvSecret` / `upsertProvider` 的返回统一硬编码成：

- `provider.env`
- `provider.patch`

于是：

- `provider.env.invalid-value` 到了前端仍是 `provider.env`；
- `provider.conflict` 仍是 `provider.patch`；
- `provider.patch.block-corrupt` 仍是 `provider.patch`。

**错误提示的“文字”修好了，但“code”没有端到端透传。**

其余 P0/P1 仍未动。

---

## 1. r5 实际改了什么

相对 r4：

| 文件 | 变化 |
|---|---|
| `src/provider-env.js` | 透传 code/hint；所有空格都拒绝 |
| `scripts/test-provider-env.mjs` | 新增 4 项非法值测试 |
| `plugins/surfcore/lib/client.js` | 直连文案与后端能力对齐 |

测试机自测：

```text
test-dsh-provider-patch    32/32
test-provider-env          24/24
test-provider-ui           12/12
test-scene-models          11/11
test-secret-store          12/12
test-voice-import-checksum   6/6
test-voice-direct-tts      12/12
test-voice-pack-import      9/9
```

我复跑结果一致：**全部通过**。

---

## 2. r5 修好的

### 2.1 `.env` 非法值现在有正确 code/hint

`writeEnvSecret()` 现在：

```js
return {
  ok: false,
  code: e.code || 'provider.env.invalid-value',
  error: e.message,
  hint: e.hint
}
```

用户填 `sk-abc#def` 时，提示会是“key 里含有 .env 保留字符”，不再误报“变量名非法”。

### 2.2 空格处理

现在 `/\s/` 一律拒绝，包括中间空格；这比只拒绝首尾更安全。

### 2.3 文案

`client.js:6011` 现在写：

> MiniMax / 阿里 CosyVoice 后端已支持，入口在「全部参数」（专用卡片待做）

不再说“正在接入”，和后端一致。

---

## 3. 新的端到端报错问题

### 3.1 API 硬编码 code

`plugins/surfcore/lib/index.js` 的 `handleProvider`：

```js
if (!envResult.ok) {
  json(res, 400, { ok: false, code: 'provider.env', ... });
}
...
if (!result.ok) {
  json(res, 400, { ok: false, code: 'provider.patch', ... });
}
```

问题：

| 底层实际 code | API 返回 | 前端看到 |
|---|---|---|
| `provider.env.invalid-value` | `provider.env` | 通用 code |
| `provider.conflict` | `provider.patch` | 通用 code |
| `provider.patch.block-corrupt` | `provider.patch` | 通用 code |

`message` 和 `hint` 是正确的，但 **code 被覆盖**。  
如果 UI/日志按 code 做分支，仍然会误判。

**修法：**

```js
code: envResult.code || 'provider.env'
code: result.code || 'provider.patch'
```

### 3.2 测试没有覆盖 API

`test-provider-env` 只测 `writeEnvSecret` 模块，不测 `/provider` 路由。

所以：

- 模块层 24/24 通过；
- API 层仍会把 code 改错；
- 交接里“code/hint 已透传”只对模块成立。

**需要**：加一个 API 级测试，模拟 `writeEnvSecret`/`upsertProvider` 返回带 code 的结果，断言 JSON 原样透传。

---

## 4. 仍未修（与前几轮一致）

### P0-1：两文件事务

仍未：

```text
apply：先写 .env → 再写 patch
clear：先删 .env → 再删 patch
```

patch 失败时 key 已改；clear 失败时 key 已删。

### P0-2：冲突检测仍按行匹配

仍只认：

```yaml
- id: llm-deepseek
```

不认引号/缩进/`insert:` 里的 id。

### P0-7：YAML 预校验 / DSH 启动验证

未做。

### P1：checksum 覆盖完整性

`verifyChecksums` 仍只校验清单列出的文件，清单只写一个文件也会 `ok:true`。

### P1：checksum 路径 / 文件名

`path.join(dir, row.rel)` 仍可 `../` 越界；仍取第一个 `*.sha256.txt`。

### P1：zip 清理 / 空间 / 超时

`inspectImportZip` 仍不清理 `state/voice-import-tmp/<ts>`，解压前不查磁盘，不给超时。

### P1：B站场景模型

仍未接 scheduler，也没有禁用选项。

### P1：直连 TTS 专用 UI

仍未做；用户只能去全部参数改。

---

## 5. 报错闸门现状

### 现在正确的

- `provider.patch.unreadable`：API catch 后返回 409 JSON；
- `provider.patch.block-corrupt`：upsert/remove 都会拒绝；
- `.env` 非法值：模块层 code/hint 正确；
- `provider.probe-*`：有 code/hint；
- checksum / zip / TTS：有 code/hint。

### 仍然断掉的

1. `.env` code 到 API 被改成 `provider.env`；
2. `provider.conflict` 到 API 被改成 `provider.patch`；
3. `provider.patch.block-corrupt` 到 API 被改成 `provider.patch`；
4. 两文件事务没有 `provider.apply.partial`；
5. YAML 预校验没有 `provider.patch.parse-failed`；
6. B站场景没有 `models.scene-unsupported`；
7. checksum 部分清单没有 `import.checksum-incomplete`；
8. zip 清理没有 `import.staging-cleanup-failed`。

---

## 6. r6 建议顺序

1. **API 透传 code**（一行级，但直接决定前端能不能按 code 处理）；
2. **两文件事务 + rollback**；
3. **冲突检测改 YAML 解析**；
4. **YAML 预校验 + DSH 启动验证**；
5. **checksum 完整性 / 路径 / 文件名**；
6. **zip 清理 / 空间 / 超时**；
7. **B站 scheduler 或禁用**；
8. **直连 TTS 专用卡片**。

---

## 7. 一句话

**r5 把模块层报错修对了，但 `/provider` API 又把 code 改回通用值；用户看到的文字是对的，程序看到的 code 还是错的。**

其余 P0/P1 没动，仍不建议合 main。
