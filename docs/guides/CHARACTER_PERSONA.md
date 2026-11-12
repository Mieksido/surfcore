# 角色人格（Character Persona）

> 一个角色 = 人格卡 + 衰减记忆卡 + 全量记忆卡 + B站 行为账本。
> 切换角色时，整套东西一起换，不允许「人格换了、记忆/账本还是上一个人的」。

---

## 1. 存储布局

```
~/.dsh/surfcore/characters/
├── current.json                 # 当前角色 + epoch（唯一真相，原子替换）
├── index.json                   # 角色列表
└── <id>/
    ├── character.json           # 清单（名字、personaMeta、创建/更新时间）
    ├── persona.md               # 人格卡
    ├── memory/
    │   ├── memory-card.json     # 衰减记忆卡
    │   ├── memory-card.md
    │   ├── memory-card-prompt-qq.md
    │   ├── memory-card-prompt-bili.md
    │   ├── memory-inbox.jsonl
    │   ├── memory-card-full.jsonl      # 全量记忆（append-only，不生成 prompt）
    │   ├── memory-card-full-stats.json
    │   ├── memory-card-full.md
    │   ├── qq-for-bili.md       # QQ→B站 脱敏记忆（按角色）
    │   └── sync-state.json
    ├── bili/                    # B站 行为账本（按角色）
    │   ├── quota.json / scores.json / favorites.json / feedback.json
    │   ├── daily-dynamic.json / dyn-kinds.json / dynamic-pins.json / game-rotation.json
    │   ├── whale-diary.md / whale-diary-private.md / whale-log.jsonl / whale-night.json
    │   ├── attacks.json / dm-quota.json / dm-await-state.json / pending-replies.json
    │   ├── fish-guard.json / silence-seen.json
    │   └── bili-memory.json / .md / -brief.md / bili-video-titles.json
    └── snapshots/
        ├── before-switch/       # 每次切换前，覆盖旧角色
        ├── auto-YYYY-MM-DD/     # 每日自动
        └── manual-*/            # 手动（保留最近 20 份）
```

**为什么不把全部内容塞进一个字面意义的单文件**：全量记忆默认上限 10GB，且是 append-only JSONL；
单 JSON 每次保存都要整份重写，迟早写坏。需要单文件时请用目录包导出（以后加 zip 导出）。

账号级东西**不进角色包**：B站 cookie（`bili/credentials.json`）、表情包（`bili/memes/`）、ffmpeg（`bili/bin/`）、
身份对齐表（`alignments.json`）、配置（`config.json` / `bili.config.json`）。

---

## 2. 切换序列（为什么这样不会串）

加载角色（`POST /dsh-surfcore/api/characters {action:'load', id}`）按固定顺序：

1. `memoryCardIdle()`：等记忆卡维护/压缩的异步链清空，避免半截写盘；
2. **停 B站 生物钟**：`scheduler.retire()` 清定时器、杀直播间进程，并 `sessionController.cancel` 旧 DSH 会话；
3. **停 QQ 桥接**：先 `stopAllBridgeSessions()` 逐个 reset 会话 + `/api/socialV2/reset`，再停进程；
4. 给旧角色拍 `before-switch` 快照；
5. 原子写 `current.json`（`epoch + 1`），更新 `current-role.json`；
6. 把桥接的 `sessions.json` / `social-v2.json` 移到 `backups/character-switch-*`；
7. 用新角色的记忆卡生成 prompt；
8. 重启 QQ 桥接（读新角色）与 B站 生物钟（会话 id = `bili-whale-<角色 id>`）。

任何一步在写指针前失败 → 不切换，恢复旧调度器；写指针后失败 → 角色已切换但平台保持停止，日志里有原因。

`epoch` 的作用：旧进程/旧回合即使晚到，也不会被当成新角色。所有长任务在开始时捕获当前角色目录；
写记忆/账本只写捕获到的那份；需要对外发送的旧回合在切换时已被取消。

---

## 3. 隔离矩阵

| 数据 | 隔离 | 说明 |
| --- | --- | --- |
| 人格卡 | ✅ 按角色 | `persona.md`；QQ/B站 每次注入都读当前角色 |
| 衰减/全量记忆 | ✅ 按角色 | `memory/`；QQ 注入块、B站 记忆都由当前角色生成 |
| QQ 记忆 inbox | ✅ 按角色 | 桥接启动时解析当前角色路径 |
| B站 额度/评论/动态/评分/收藏/日记 | ✅ 按角色 | `tools/lib/state-paths.mjs` 每次进程启动解析当前角色 |
| 分享排期/已用素材 | ✅ 按角色 | 迁移时从 `repo/state` 拷进角色包，避免当天重发 |
| 动态基线/缓存 | ✅ 按角色 | 新角色空基线，不会重放旧动态 |
| B站 记忆简报 | ✅ 按角色 | `bili-memory.*` 在角色 `bili/` 下 |
| QQ/B站 会话 | ✅ 切换时重建 | 桥接会话映射归档；B站 会话 id 带角色 id |
| B站 cookie / 表情包 / ffmpeg | ❌ 全局 | 账号级资源 |
| 身份对齐表 | ❌ 全局 | “谁是谁”跨角色仍然有效 |
| B站 偏好/额度规则 | ❌ 全局（v1） | `bili.config.json` 的 preferences/limits 目前共用 |

---

## 4. 存档与回档

- **手动存档**：`snapshot`，槽名 `manual-<标签>-<时间>`，保留最近 20 份。
- **自动存档**：启动 10 秒后 + 每 6 小时检查一次；每天最多一份 `auto-YYYY-MM-DD`。
- **12 个自动槽**：`before-switch` + 180 / 90 / 60 / 30 / 15 / 10 / 7 / 5 / 3 / 2 / 1 天。
  每次自动检查时，按快照时间就近保留这 11 个年龄档 + 切换前槽；多余自动档删除。
- **回档**：先给当前状态拍 `pre-restore-*`，再覆盖 `persona.md`、衰减卡与两份 prompt、B站 行为账本；
  全量记忆 JSONL **不截断**（append-only，回档不删后来真正发生过的记忆）。回档后 `epoch +1` 并重启平台。

快照里的大文件优先**硬链接**（同一卷），不复制 10GB；删除快照只删链接。

---

## 5. 旧数据迁移

插件启动时若还没有 `characters/current.json`：

1. 找到旧人格卡（`persona.file` / `roles/角色卡.md` / `roles/*.md`）；
2. 建一个角色（名字取人格卡标题，例如「小咪」）；
3. 复制 `~/.dsh/surfcore/memory/*`（全量 JSONL 硬链接）；
4. 复制 `~/.dsh/surfcore/bili/*` 里的**行为文件**（不含 cookie/表情包/bin）；
5. 复制 `repo/state` 里的 `bili-share-state.json` / `bili-share-history.json`（避免当天重发）；
6. 写 `backups/character-migration-*` 清单 + 小文件备份；
7. 写 `current.json`，重启桥接一次。

旧目录**不删除**，作为冷备份；迁移幂等（已有 current 就跳过）。测试里用
`SURFCORE_DISABLE_CHARACTER_MIGRATION=1` 关闭。

---

## 6. API（设置页用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-surfcore/api/characters` | 当前角色、角色列表、当前角色快照 |
| GET | `/dsh-surfcore/api/characters?id=<id>` | 单个角色详情（人格卡全文、路径、快照） |
| POST | 同上 `{action:'create', name, personaText, memoryCard, fullRecords, load?}` | 新建；`load:true` 创建后立即加载 |
| POST | 同上 `{action:'load', id}` | 切换（自动存档旧角色 + 重启平台） |
| POST | 同上 `{action:'update', id, name?, personaText?}` | 改名字/人格卡 |
| POST | 同上 `{action:'snapshot', id, label?}` | 手动存档 |
| POST | 同上 `{action:'auto-snapshot', id}` | 立即跑一次自动存档轮换 |
| POST | 同上 `{action:'restore', id, slot}` | 回档当前角色 |
| POST | 同上 `{action:'delete', id}` | 归档删除（当前角色拒绝；目录移进 backups） |
| POST | 同上 `{action:'migrate'}` | 手动触发旧数据迁移 |

请求体上限 16MB（导入全量记忆时注意）。

---

## 7. 验证

- `node scripts/test-character-store.mjs`：多角色隔离 / epoch / 快照回档 / 迁移 / 凭证不进角色包；
- `node scripts/test-bili-state-paths.mjs`：B站 工具读角色账本、cookie 仍走账号目录；
- `cd plugins/surfcore && node scripts/test-character-api.mjs`：API 新建/加载/存档/回档/删除；
- `cd plugins/surfcore && npm test`；`npm run test:audit`。

---

## 8. 已知边界（v1）

- 角色包不包含 B站 偏好（`preferences`）与额度规则（`limits`），这些仍全局；
- 不迁移/回档全量记忆（append-only，避免删除真实记忆）；
- 切换会短暂停 QQ 桥接（几秒），期间消息由 SnowLuma/QQ 侧排队；
- 角色 id 是 ASCII slug 或 `char-<时间>`，中文名只做显示；
- 还没有单文件导出/导入（zip），目录包可直接拷走。
