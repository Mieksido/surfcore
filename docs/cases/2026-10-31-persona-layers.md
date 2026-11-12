# 人格卡分层（Persona Layers v1）

- **日期**：2026-10-31
- **范围**：只动人格卡；记忆卡/向量记忆冻结，不在本批。
- **用户决定**：
  1. 保留 `persona.md` 作为人格核心；
  2. QQ 场景分群聊/私聊；
  3. 全部手动编辑，模型不自动改写；
  4. 角色页要醒目说明这次改动，并让用户直接编辑各层。

## 1. 链路

```
角色页「人格卡」
  ├─ 人格核心  persona.md
  ├─ 人格日常  persona.daily.md
  └─ 场景人格  persona.scenes/{qq-group,qq-private,bili,pet}.md
        ↓
src/persona-layers.js  composePersonaLayers()
  ├─ 按 mode 过滤 〔一代〕/〔二代〕小节
  ├─ 顺序：核心 → 场景 → 日常
  └─ 预算：核心优先，超了先裁日常，再裁场景
        ↓
注入点
  ├─ QQ 桥接：currentRoleHint(key)/currentRoleHintV2(key)
  │    key=group:* → qq-group；private:* → qq-private
  ├─ B站调度器：personaCardBlock() → bili 场景 + 日常
  └─ 桌宠：pet-chat → pet 场景 + 日常
```

## 2. 机制

### 文件兼容

- `persona.md` **继续是核心**，不迁移、不改旧角色；
- 日常/场景是可选文件；不存在时只注入核心，行为与旧版一致；
- 新文件按需创建，不批量生成空文件，避免污染快照。

### 注入顺序

```
【人格核心】...
【场景人格｜QQ 群聊】...
【人格日常】...
```

- 核心放最前：稳定、可缓存；
- 场景次之：只在当前平台/会话注入；
- 日常最后：变化最频繁，超预算先裁它；
- 只有核心时不加标题，旧角色卡字节不变。

### 场景选择

| 会话/平台 | 场景文件 |
| --- | --- |
| `group:*` | `persona.scenes/qq-group.md` |
| `private:*` | `persona.scenes/qq-private.md` |
| B站 | `persona.scenes/bili.md` |
| 桌宠 | `persona.scenes/pet.md` |

### 预算

- 总预算沿用 `role.maxInjectChars`（默认 6000）；
- B站沿用 `persona.compactChars`（默认 2200）；
- 桌宠 4200；
- 超预算：先日常，再场景；核心优先保留；核心自身超限才截断并标记 `truncated`。

### 手动编辑

- `/persona` GET 返回 `core/daily/scenes` 三层；
- POST `{layer:'core'|'daily'|'scene', scene, text}` 只写当前层；
- 空文本允许清空日常/场景；核心至少 50 字；
- 敏感内容（密钥/身份证/住址）拒绝保存；
- 每次保存先备份，恢复按备份名前缀回到对应层；
- 模型不自动生成、不自动升层。

## 3. 爆炸半径

- 改注入内容：影响 QQ / B站 / 桌宠的下一条提示词；
- 不改记忆卡、不改角色切换、不改 B站 会话；
- 旧角色没有新文件 → 行为与旧版一致；
- 快照/回档新增复制三层；旧快照缺少新文件时只恢复存在的层，不删除当前层。

## 4. 取舍

- **A：继续单张 `persona.md`**：改动最小，但日常/场景混在一起，缓存和平台隔离都做不了。
- **B：改名 `persona.core.md` 强制迁移**：语义最干净，但破坏旧角色、快照、导入。
- **C（采用）：`persona.md` 保持核心，新增可选 daily/scenes**：兼容、渐进、可回滚。
- QQ 场景按群聊/私聊分，而不是再按群号分：先解决平台差异，避免一上来切太细。

## 5. 生效与重启

- 保存人格卡：QQ 下一条消息、B站下一次醒来、桌宠下一次对话生效；
- 桥接/Scheduler 读文件，不需要重启 DSH；
- 角色页刷新即可看到三层。

## 6. 验证

```bash
node scripts/test-persona-layers.mjs
node plugins/surfcore/scripts/test-character-api.mjs
node plugins/surfcore/scripts/test-client-contract.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

覆盖：

- 核心/场景/日常顺序与预算裁剪；
- QQ 群聊/私聊场景选择；
- v1/v2 小节过滤；
- `/persona` 三层读写、未知场景结构化错误；
- 快照/回档带日常层；
- 客户端有分层提醒、逐层保存、手动编辑说明。

## 7. 回滚与残余

- 回滚：停止读取 daily/scenes，只读 `persona.md`；新文件保留不删，可再启用。
- 未做：
  - 日常/场景自动生成（用户明确要手动）；
  - 按任务类型（回复/主动/记忆维护/故障恢复）的 ContextRecipe；
  - 记忆分层/向量记忆；
  - 缓存命中率与 token 收益的实测。
- 已知边界：
  - 旧角色不会自动创建 daily/scenes，需要用户手动保存一次；
  - B站/桌宠也读日常层，但预算各自不同；
  - 场景只按平台/群聊私聊，不按具体群号。
