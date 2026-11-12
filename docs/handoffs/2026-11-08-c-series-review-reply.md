# 对 C 系列交接的审阅回复

> 2026-11-08 · 开发机审阅
> 审阅对象：`surfcore-c-opt-2026-11-08.bundle` / `feat/opt-voice-models`
> 基线：`669beb8`（0.8.9-dev.1 快照）
> 分支 HEAD：`8d4c433`
> 审阅方式：只读检查 bundle、分支 diff、代码和测试；**没有合并、没有改工作区**。

---

## 0. 先给结论

这套东西的方向是对的，但**不是“可以直接合”的状态**。

准确判断：

- **大部分是功能/内容层改动**，不需要重构 SurfCore 进程架构；
- **C3 自定义服务商不是普通内容**：它直接改 DSH profile 和 `.env`，是一个新的高风险基础设施边界；
- 当前最危险的不是 UI，而是：
  1. profile + `.env` 写入没有事务/回滚；
  2. 密钥明文、备份、脱敏、值校验都有缺口；
  3. sha256 校验看起来比实际强，存在“部分清单也算通过”的假安全感；
  4. 直连 TTS 后端有了，但设置页没有入口；
  5. 交接说 112 项全过，实际 `test-scene-models` 有 2 项失败。

**建议：拆开处理，不要整包直接合。**

---

## 1. 这次 C 系列到底是什么（人话）

测试机做的是一个“模型/语音接入增强包”：

1. **模型栏**：把模型设置从 QQ 页挪到独立【模型】栏；
2. **自定义服务商**：用户填中转站/反代地址、API Key、模型清单，SurfCore 写进 DSH profile，并写 `.env`；
3. **按场景换模型**：QQ / B站 / 桌宠分别可选不同模型，后台任务理论上可以更省；
4. **语音包**：
   - 新增使用说明；
   - 支持直接选 zip 导入；
   - 支持 `*.sha256.txt` 校验；
   - 在线下载折叠到“高级”；
5. **直连云端 TTS**：MiniMax / 阿里 CosyVoice，不走 voxd。

一句话：

> 让用户不写插件就能接自己的模型服务商、按平台分配模型、更安全地导入语音包，并多两种云端语音。

方向值得做；实现需要补边界。

---

## 2. 需要动架构，还是只是内容？

### 结论：功能为主；C3 是“新的外部配置写入边界”

| 模块 | 性质 | 判断 |
|---|---|---|
| C6 语音包说明 / zip / sha256 | 内容 + 导入流程 | 不需要动核心架构 |
| C4 场景模型 | 桥接路由策略 | 不需要动核心架构 |
| C5 直连 TTS | 外部服务商适配器 | 不需要动核心架构 |
| C3 自定义服务商 | **写 DSH profile + `.env`** | **需要单独的安全边界/事务层** |

C3 的链路是：

```text
设置页
  → /api/provider
  → 写 ~/.dsh/profiles/<profile>/cordis.patch.yml
  → 写 ~/.dsh/.env
  → DSH 启动时加载
```

这不是 SurfCore 自己的 state，而是 **DSH 的启动配置**。  
写坏了，不是“模型不可用”，而是 **DSH 可能起不来**。

所以：

> **不需要拆 SurfCore 的进程/状态架构；但 C3 不能只当设置页表单，必须有“事务 + 回滚 + DSH 健康验证”的边界。**

---

## 3. 当前分支的实际规模

```text
基线：669beb8（0.8.9-dev.1 快照）
HEAD：8d4c433
diff：18 个文件，+1690 / -11
新增：6 个 src 模块、6 个测试、1 个 UI 栏目
```

新增/修改：

- `src/dsh-provider-patch.js`
- `src/provider-env.js`
- `src/secret-store.js`（**未接线**）
- `src/voice-direct-tts.js`
- `src/voice-pack-import.js` / `src/voice-packs.js`
- `src/bridge.js`：场景模型、直连 TTS、zip 路由
- `plugins/surfcore/lib/index.js`：`/provider` 接口
- `plugins/surfcore/lib/client.js`：模型栏、ProviderCard、语音说明、zip 入口
- `config.example.json`：`models.scenes`、`tts.direct`

## 3.1 尚未验证的架构假设

1. **DSH profile patch 的 `- id` 语义**：当前 profile 里既有顶层 `- id`，也有 `- insert:`。
   代码假设顶层 `- id: llm-deepseek` 能覆盖/新增 provider；是否在用户当前 profile 下成立，
   没有真实 DSH 启动测试。
2. **`.env` 生效时机**：代码/UI 都写“重启 DSH 后生效”，但没有真机验证 key 是否被 DSH 进程读到。
3. **B站 scheduler 是否走桥接**：已知不保证；这是场景模型的功能缺口。


---

## 4. P0 / P1 问题

### P0-1：profile 和 `.env` 不是一个事务

`plugins/surfcore/lib/index.js` 的 `handleProvider`：

- apply 时先 `writeEnvSecret()`；
- 再 `upsertProvider()`；
- 如果 patch 失败（例如 `provider.conflict`），`.env` 里的 key 已经被改。

clear 时先删 `.env`，再删 profile；如果删 profile 失败，DSH 还会引用 provider，但 key 没了。

**需要：**

- 两文件事务（journal / 临时写 / 全部成功后提交）；
- 任一步失败恢复两边；
- 返回 `provider.apply.partial` / `provider.rollback`，不能只报“patch 失败”。

### P0-2：profile 冲突检测只认一种写法

`src/dsh-provider-patch.js` 只检查：

```yaml
- id: llm-deepseek
```

这些都不会被识别：

```yaml
- id: 'llm-deepseek'
- id: "llm-deepseek"
  - id: llm-deepseek   # 在 insert 里
```

结果：用户已有自己的 provider，SurfCore 仍写入，覆盖/重复，DSH 可能启动失败。

**建议**：用 `js-yaml` 解析后按 `id` 检查，不要按行字符串匹配。

### P0-3：`readPatch()` 读失败被当成空文件

```js
try { return fs.readFileSync(...) } catch { return ''; }
```

文件存在但没权限/被占用 → 返回空串 → 冲突检测失效 → 可能覆盖原文件。

**读失败必须返回错误，不能当空文件。**

### P0-4：`stripBlock()` 只有 BEGIN 没有 END 会截断用户内容

```js
if (j < 0) return s.slice(0, i);
```

如果用户文件里有同名 BEGIN 但没有 END，后面所有内容会被当成 SurfCore 区块，`removeProvider` 会删掉。

**建议**：无 END 时直接报错，不删任何内容。

### P0-5：`.env` 值是裸拼接，可能写坏/注入

`src/provider-env.js`：

```js
out.push(`${m[1]}${name}=${value}`);
```

没有拒绝换行、没有引号规则。key 里带换行可以变成两条环境变量；带 `#` 可能被当注释。

**必须**：

- 拒绝 `\r\n`；
- 按 dotenv 规则转义/加引号；
- 专门测试特殊字符。

### P0-6：`.env` 备份是明文且不清理

`provider-env.js` 的 `backupFile()` 每次写都复制 `.env` 到 `backups/`，**没有上限**，每份都是明文 key。

`dsh-provider-patch.js` 的 profile 备份会保留 5 份；`.env` 不会。

**需要**：限制备份数量、权限收紧、摘除时清理相关备份。

### P0-7：固定 `SURFCORE_RELAY_KEY` 会覆盖用户自己的变量

index.js 写死 `PROVIDER_ENV_KEY = 'SURFCORE_RELAY_KEY'`。

如果用户 `.env` 本来就有这个变量：

- apply 覆盖；
- clear 删除。

**建议**：按 profile/provider 生成唯一变量名，或只删除“我们创建的”变量。

### P0-8：直连 TTS 的 key 没有脱敏

`plugins/surfcore/lib/store.js` 的 `SECRET_PATHS` 没有：

```text
socialV2.voice.tts.direct.apiKey
```

结果：

- key 明文存在 `config.json`；
- `/config` 返回给前端；
- 不在 UI 脱敏范围。

**需要加入 `SECRET_PATHS`，并在 UI 上只显示打码值。**

### P0-9：没有 YAML 预校验 / DSH 启动验证

现在只校验字段，没有：

- 用 YAML parser 解析生成的 patch；
- 写前 dry-run；
- 写后判断 DSH 是否还能启动；
- 启动失败自动恢复。

交接文档自己写了 DSH user patch 出错会抛异常。  
这是最需要补的 gate。

---

### P1-1：sha256 清单不要求覆盖全部文件

`src/voice-pack-import.js` 的 `verifyChecksums()`：

- 只校验清单列出的文件；
- 清单只写 `config.toml` 一行，也会 `ok:true`；
- `inspectImport()` 会把它当 `verified:true`。

结果：

> 包内放一个合法 checksum 文件，改掉真正的 `voxd`/二进制，也可能显示“已验证”。

**建议**：

- 清单必须覆盖包内应校验的文件；
- 或要求 manifest 明确列出 `files`;
- 至少返回“清单只覆盖 N 个文件，共 M 个”并在 UI 明示。

### P1-2：checksum 文件匹配太宽

`verifyChecksums` 找第一个 `*.sha256.txt` / `sha256sums.txt`，不校验文件名和包名。

网盘目录里有一个无关 checksum：

- 可能错误拒绝；
- 可能用错清单。

**建议**：按包名匹配（如 `voice-local*.sha256.txt`），或要求包内清单优先。

### P1-3：checksum 路径没有防目录穿越

```js
const abs = path.join(dir, row.rel);
```

清单里写 `../../file` 会去包外找。

**建议**：`path.resolve(dir, rel)` 后检查必须以 `dir + sep` 开头；越界直接报 `IMPORT_CHECKSUM_PATH_INVALID`。

### P1-4：zip 临时目录不清理

`inspectImportZip` 解压到：

```text
state/voice-import-tmp/<timestamp>/
```

成功、失败、取消都不清理。大包会长期占盘。

**建议**：`try/finally` 清理，或保留一个“最近一次导入”目录，其余定期清理。

### P1-5：zip 解压前没有空间检查/超时/大小上限

- `checkFreeSpace` 在后面的 `startImport` 才做；
- `Expand-Archive` 没有 timeout；
- 没有 zip bomb/解压后大小上限；
- 取消不能中断 PowerShell。

**建议**：解压前检查磁盘；限制 zip 大小/解压后大小；给解压进程超时和取消。

### P1-6：B站场景模型可能静默不生效

`src/bridge.js` 的 `sceneModelOverride()` / `ensureChatModel()` 只覆盖经过桥接的会话。  
B站 scheduler 自己创建会话，不走这里。

结果：

- UI 给 B站选了模型；
- 实际仍用全局模型；
- 没有报错、没有提示。

这是“静默不生效”，比报错更危险。

**建议**：在 scheduler 侧调用同一套 setSessionModel；做不到就先禁用 B站场景选项并说明。

### P1-7：直连 TTS 后端有了，但没有 UI 入口

`client.js` 里没有：

- `socialV2.voice.tts.direct.provider`
- API Key
- GroupId
- voiceId

说明却写“设置 → 语音 → 直连服务商”，这个入口不存在。用户只能手改 `config.json`。

**建议**：补 UI，或把文档改成“仅配置文件”，不要二选一都占。

### P1-8：场景模型不校验存在性，且换模型没有上下文提示

- UI 只红字提示目录外模型，不阻止保存；
- 保存后可能 selectModel 失败；
- 或 fallback 到别的模型，用户以为配置成功；
- 换模型可能改变上下文/费用，没提示。

**建议**：保存前校验模型是否存在；至少给“模型不存在/将回落到默认”的明确错误码。

### P1-9：测试交接说 112 项全过，实际不是

我只读跑了新增测试：

```text
test-dsh-provider-patch   28 通过
test-provider-env         20 通过
test-provider-ui          12 通过
test-scene-models         11/13 通过（2 失败）
test-secret-store         12 通过
test-voice-import-checksum 6 通过
test-voice-direct-tts     12 通过
```

失败项：

```text
场景 proactive 有默认空位
场景 background 有默认空位
```

代码已经删除任务维度，测试仍期待 `proactive/background`。  
这说明：

- 测试没同步；
- `test:audit` 会红；
- “112 项全过”的交接结论不成立。

---

## 5. 报错闸门分析

### 已经做对的部分

| 场景 | 现有 code | 有 hint |
|---|---|---|
| profile 不存在 | `provider.profile-missing` | 有 |
| 同 id 冲突 | `provider.conflict` | 有 |
| 探活网络失败 | `provider.probe-network` | 有 |
| 探活超时 | `provider.probe-timeout` | 有 |
| 探活 401/403/404 | 带 note | 有 |
| zip 解压失败 | `IMPORT_UNZIP_FAILED` | 有 |
| checksum 不匹配 | `IMPORT_CHECKSUM_MISMATCH` | 有 |
| 直连缺 key | `tts.direct-key-missing` | 有 |
| 直连缺音色 | `tts.direct-voice-missing` | 有 |
| 直连 HTTP 错误 | `tts.direct-http` | 有 |

ProviderCard 会把 `message + hint` 显示出来；这一点是好的。

### 还没有报错/会静默的地方

1. **profile 写入后 DSH 启动失败**：没有检测、没有自动恢复。
2. **`.env` 写成功、profile 写失败**：用户只看到 patch 错误，不知道 key 已改。
3. **B站场景模型不生效**：没有 code。
4. **checksum 部分清单**：显示“已验证”，没有“只覆盖 N 个文件”的警告。
5. **zip 临时目录残留**：没有清理提示。
6. **`.env` value 含换行**：没有校验，没有 code。
7. **`handleProvider` JSON 解析失败**：直接 500，没有 `code/hint`。
8. **直连 TTS 没有 UI**：用户根本走不到错误提示。

### 建议补充的 code / 行为

| 新 code | 何时 | 用户建议 |
|---|---|---|
| `provider.apply.partial` | env 写成功、patch 失败 | 已恢复/需要恢复备份 |
| `provider.patch.parse-failed` | 生成 YAML 解析失败 | 保留原文件，恢复备份 |
| `provider.env.invalid-value` | key 含换行/非法字符 | 重新输入 key |
| `provider.env.user-var-conflict` | 变量已存在且不是我们写的 | 手动确认/换变量名 |
| `provider.rollback-failed` | 回滚也失败 | 给备份路径，手动恢复 |
| `models.scene-unavailable` | 选中的模型不存在 | 重新选模型 |
| `models.scene-unsupported` | B站 scheduler 不支持 | 暂时用全局/等实现 |
| `import.checksum-incomplete` | 清单未覆盖全部文件 | 重新下载/补清单 |
| `import.checksum-path-invalid` | 清单有 `../` | 拒绝导入 |
| `import.staging-cleanup-failed` | 临时目录清不掉 | 提示手动清理路径 |

每个错误至少包含：

```json
{
  "ok": false,
  "code": "...",
  "error": "人话原因",
  "hint": "下一步做什么",
  "detail": {}
}
```

UI 不能只 toast 一句“失败”，要保留可见的错误块和重试/恢复按钮。

---

## 6. 建议修复顺序（不要整包合）

### 第 1 批：C3 的事务与密钥安全（最高优先）

1. 抽出 `applyProviderConfig` 事务层：
   - 先读 profile + env；
   - 校验 YAML；
   - 两边都写临时文件；
   - 成功才 rename 提交；
   - 任一步失败回滚两边。
2. `readPatch` 读失败必须报错，不能返回空。
3. 冲突检测改为 YAML 解析，覆盖引号/缩进/insert。
4. `stripBlock` 只有 BEGIN 没 END 时报错。
5. `.env` value 校验/引号；备份裁剪；环境变量名唯一化。
6. 加入 `socialV2.voice.tts.direct.apiKey` 到 `SECRET_PATHS`。
7. 增加“DSH 启动失败恢复”说明/按钮。

### 第 2 批：C6 语音包完整性

1. 清单覆盖完整性校验；
2. checksum 文件名匹配；
3. 路径穿越防护；
4. zip 临时目录 `try/finally` 清理；
5. 解压前磁盘检查、超时、大小上限；
6. 补“部分清单”“额外文件”“路径穿越”测试。

### 第 3 批：C5 直连 TTS

1. 补 UI 或明确只支持配置文件；
2. CosyVoice 音频格式/时长验证；
3. endpoint 限制和大小上限；
4. key 脱敏、缓存清理。

### 第 4 批：C4 场景模型

1. B站 scheduler 接入，或禁用 B站选项；
2. 保存前校验模型存在；
3. 换模型上下文提示；
4. 修 `test-scene-models`，重新跑 `test:audit`。

---

## 7. 测试机复验清单

请测试机按这个顺序验，不要只验“能打开”：

1. 自定义服务商：
   - 正常保存；
   - 同 id 冲突（手动在 profile 里写一个 `- id: 'llm-deepseek'`，再保存，必须拒绝且文件不变）；
   - 移除；
   - 每次都要完整退出并重开 DSH，确认能启动。
2. `.env`：
   - key 里带换行/`#`/空格，必须拒绝或安全转义；
   - 检查 `backups/` 是否无限增长。
3. 场景模型：
   - QQ 选模型 → 保存 → 确认实际 selectModel 日志；
   - B站选模型 → 观察是否真的生效（当前预期可能不生效）；
   - 选一个不存在的模型 → 必须明确报错，不能静默 fallback。
4. 语音包：
   - 正常 zip；
   - 截断/改坏一个文件；
   - 清单只列一个文件但改另一个文件；
   - 取消导入后 `state/voice-import-tmp` 是否残留。
5. 直连 TTS：
   - 设置页是否真的有入口；
   - MiniMax/CosyVoice 真实 key 是否能合成；
   - 非 WAV 返回时下游是否能处理。
6. 门禁：
   ```text
   node scripts/test-scene-models.mjs   # 必须 13/13
   npm run test:audit                   # 不能因为这条红
   ```

---

## 8. 风险结论

| 风险 | 级别 | 结论 |
|---|---|---|
| 改 DSH profile 导致启动失败 | P0 | 必须事务/回滚/YAML 预校验 |
| `.env` 明文/备份/值注入 | P0 | 必须修 |
| 同 id 冲突漏检覆盖用户配置 | P0 | 必须修 |
| 直连 key 未脱敏 | P0 | 必须修 |
| checksum 部分清单假验证 | P1 | 必须修 |
| zip 临时目录/磁盘/超时 | P1 | 应修 |
| B站场景静默不生效 | P1 | 应修或禁用 |
| 直连 TTS 没有 UI | P1 | 功能未完成 |
| 测试 2 项失败 | P1 | 门禁不成立 |
| profile 选择 heuristic | P2 | 需要 profile 选择/确认 |
| 探活/直连 endpoint 任意 URL | P2 | 至少给“会带 key 请求该地址”的警告，限制协议/域名 |
| `test-provider-ui` 说卡片在 QQ 页 | P2 | 测试文案未跟上实际 ModelsTab |
| 探活只测根地址 | P2 | UI 要说明“可达≠能回话” |
| secret-store 未接线 | P2 | 不要宣传“已加密” |

---

## 9. 最终判断

- **这不是一次核心架构重构**；
- C6/C4/C5 是功能内容，补测试和边界即可；
- **C3 必须按“外部配置写入基础设施”来做**，不能当普通设置卡；
- 当前分支**不建议直接合 dev/main**，更不建议直接发版；
- 建议先拆 C6 低风险部分，再单独做 C3 事务层，最后补 C5 UI 和 C4 B站。

一句话：

> **方向对、功能有价值；但现在的实现把“写 DSH 启动配置 + 明文密钥 + 完整性校验”三件高风险事情揉在一个功能包里，先把事务、密钥和校验边界补好，再谈合并。**
