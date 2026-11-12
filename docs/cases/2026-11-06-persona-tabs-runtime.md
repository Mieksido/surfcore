# 2026-11-06 · 人格卡整卡/拆分双通道 + runtime 上移

## 1. 人格卡双通道

### 需求

- 角色页人格卡拆成两个 Tab：
  1. 整个人格卡注入（整卡，放最前）；
  2. 拆分人格卡（核心/语气/日常/场景，省 token）。
- 两个 Tab 只负责保存各自内容，互不覆盖；
- 单独选择「整卡注入 / 拆分注入」，决定提示词用哪一份；
- 拆分可能不完整、省 token；整卡完整、费 token。

### 实现

- `src/character-persona.js`：
  - 角色路径新增 `persona.full.md`；
  - `activePersonaLayers()` 返回 `full`；
  - `readPersonaLayerText('full')` 读取整卡，缺失回退核心；
  - 新建/更新角色时同时写整卡；备份/复制包含整卡。
- `plugins/surfcore/lib/index.js`：
  - `GET /persona` 返回 `layers.full`；
  - `POST /persona` 支持 `layer: 'full'`；
  - 备份恢复支持 `persona-full-*`。
- `src/bridge.js`：
  - 新增 `personaInjectionMode()` 读 `config.persona.mode`；
  - `roleHintForMode` 未显式指定时按配置选：
    - `full`：用整卡，忽略语气/场景/日常层；
    - `split`：核心 + 语气/场景/日常，`personaMode='tone'` 省核心（有语气时）；
  - `personaWakeBlockV2` / `qq_get_prompt` 跟随配置。
- `plugins/surfcore/lib/scheduler.js`（B站）和 `pet-chat.js`（桌宠）：
  - 同样按 `persona.mode` 选整卡或拆分；整卡模式不再重复拼分层。
- `plugins/surfcore/lib/store.js`：`persona.mode` 默认 `full`。
- `plugins/surfcore/lib/client.js`：
  - 角色页新增「人格注入方式」整卡/拆分按钮；
  - 两个 Tab：「整个人格卡注入」在前，「拆分人格卡（省 token）」在后；
  - 整卡 Tab 单独「保存整卡」；拆分 Tab 保留保存全部/智能拆分；
  - 选通道后需点页面底部「保存并生效」。

## 2. Runtime 上移

`EmbeddingPackPanel`：

- runtime 行从「本地模型」Tab 的包清单移到 **本地/云端两个 Tab 上方**，两个 Tab 都能看到和导入；
- 本地包清单只留本地模型；
- 文案改为“运行时在上方单独导入；这里只导入模型 zip”。

## 3. 验证

```
test-persona-layers          ✅
test-persona-classify        ✅
test-persona-wake-injection  ✅
test:audit                   151/151
plugins/surfcore npm test    0 失败
```

## 4. 边界 / 回滚

- `persona.full.md` 是新增文件，旧角色缺失时整卡模式回退 `persona.md`；
- 两个 Tab 内容独立，整卡不会自动跟拆分核心同步；
- 注入方式由 `config.persona.mode` 控制，改完必须保存并生效；
- 回滚：切回 `mode: full` 并恢复旧 `persona.md` 即可；整卡文件可保留。
