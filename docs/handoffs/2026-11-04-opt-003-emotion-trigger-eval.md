# OPT-003 评估：情绪触发 B站动态 / QQ空间说说

> 2026-11-04 · 测试机评估 · **只评估，无代码改动**
> 基线：`dev @ 404649d`（`v0.8.8-dev.1`）
> 队列出处：`docs/OPTIMIZATION-BACKLOG.md` OPT-003「情绪触发 B站 动态发布 / QQ 空间说说」
> 协调会话裁决要求：只做方案与风险评估，不写代码（`2026-11-04-测试机回执裁决.md` D4）

---

## 0. 一句话结论

**B站动态：能力已经齐全，值得做，但第一版必须「生成草稿 → 人工一键发布」。**
**QQ空间：协议通道存在（SnowLuma 有 `send_qzone_msg`），但 SurfCore 完全没接，只建议做「仅自己可见」的第二步。**
**全自动公开发布：不做。** 不是技术做不到，是「启发式情绪 × 不可撤回的公开面」这个组合不可接受（见 §4）。

---

## 1. 现状盘点（实测，非推测）

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| B站动态写通道 | ✅ 已有 | `plugins/surfcore/tools/commands/dynamic.mjs` `post --text --dry\|--go`；另有 `dynamic-image` / `edit-dynamic` / `share-dynamic` |
| 额度闸 | ✅ 已有 | `quota-gate.mjs:24` `gate({type:'dynamic', auto})`，`dynamic.mjs:105` 发布前调用 |
| 出站身份闸 | ✅ 已有 | `outbound-guard.mjs` `assertOutboundIdentitySafe(text,{surface:'B站 动态'})`，`dynamic.mjs:108` 硬拦 QQ 号/mid 泄露 |
| 四类动态自动化 | ✅ 已有 | `tools/lib/kinds.mjs`：`best/game/anime/gaming`，时段 08/12/16/20，**每类每天最多一条**，错过不补，带固定前缀与长度门禁 |
| 群内分享调度 | ✅ 已有 | `src/bili-share-scheduler.js`：8 个固定时间点投递「定时分享」提示词；`via=dynamic` 时走 `share-dynamic` |
| 情绪 / 动机层 | ✅ 已有 | `src/purpose-engine.js`：10 种情绪（`appraiseMaterial`）、9 维驱动、目标假设带 `confidence/risk`；`bridge.js:12641 purposeTick()` 每 60 秒评估一次 |
| 「只看不说」开关 | ✅ 已有 | `plugins/surfcore/lib/scheduler.js:329` 沉默逛 B站：禁止评论/发动态/分享等一切写动作 |
| QQ空间写通道 | ⚠️ **协议有，接线无** | SnowLuma 目录含 `send_qzone_msg(content, images, ugc_right, target_uins)`、`delete_qzone_msg(tid)`、`set_qzone_msg_right`、`get_qzone_msg_list`、`get_qzone_feeds`、`comment_qzone`、`like_qzone`、`set_qzone_ban`；但 `src/mcp-snowluma-safe.js` 的 45 个 `qq_*` 工具**没有一个** qzone；`bridge.js:9739 onebotSend()` 只封装 `send_private_msg` / `send_group_msg` |
| 删除 / 改权限 | ✅ B站有，qzone 有但未接 | B站 `dynamic.mjs rm`；qzone `delete_qzone_msg` / `set_qzone_msg_right` |

**关键结论：B站这条路 90% 的零件已经在仓库里；QQ空间缺的不是协议，是接线。**

---

## 2. 机制：为什么现在是这个形状

### 2.1 现有的「发布」全是 agent-mediated，没有代码直发旁路

```
调度器到点 → 投递一段提示词进会话 → 模型在会话里选素材、写文案、跑 CLI（--dry 看，--go 发）→ 写状态文件
   ↑ scheduler.js / bili-share-scheduler.js        ↑ 会话回合              ↑ daily.mjs / dynamic.mjs
```

这不是巧合，是设计取舍：文案要模型写、质量门禁在 CLI 里、额度与身份闸也在 CLI 里。
所以「情绪触发」**最省事也最不破坏架构**的接法，不是新写一个发布器，而是：
**复用 `purposeTick` 每 60 秒已有的情绪/驱动评估，决定「这一轮要不要说」，再走既有的提示词 + CLI。**

### 2.2 QQ空间为什么完全没接

- `@snowluma/sdk` / `@snowluma/mcp` 的 `.d.ts` 里没有 qzone 字样 → SDK 没有类型化封装；
- SurfCore 的模型面（MCP）是**白名单式**的，45 个工具全是 QQ 会话读写，没有一个空间类；
- 桥接的 OneBot 发送函数只认 `private` / `group` 两种 kind。

也就是说：qzone 要么走 SnowLuma 的 OneBot HTTP action（`send_qzone_msg`），要么就不存在。
**接入成本 ≈ 1 个 bridge action + 1 个额度闸 + 1 个出站身份闸 + 1 个开关**，不是重写。

---

## 3. 四条路线对比

评分口径：收益 = 用户想要的「她像活人一样有生活痕迹」；成本 = 改动面/人日；风险 = 不可撤回/风控/隐私。

| 路线 | 做法 | 收益 | 成本 | 风险 | 回滚 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 全自动公开发布** | 情绪达阈值 → 直接发 B站动态/qzone | 最高（真·自主） | 中 | **高**：启发式误判直接变成公开内容；不可撤回；账号风控连累 QQ 登录态 | 差（发出去了就发出去了） | **不做** |
| **B 草稿 + 人工一键发布** | 情绪触发 → 生成草稿 → 控制台/设置页展示 → 主人点「发布」才发 | 高（主人有最终否决权） | 中（草稿状态机 + 1 个卡片 + 1 个 action） | 中低 | 好（草稿可丢弃，未发布即无痕） | **建议 M1** |
| **C 仅自己可见（qzone）** | 发说说但 `ugc_right` 设成仅自己可见，当「心情日记」 | 中（先验证通道与文案质量） | 低 | 低（不公开） | 好（可删） | **建议 M2** |
| **D 不做** | 维持现状：情绪只进私聊，不对外发布 | 无新增 | 0 | 无 | — | 备选 |

**为什么 B 比 A 好**：把「不可撤回」这一步挪到人手上，成本只是**一次点击**，但把最坏情况从「公开面翻车」降到「草稿难看」。

---

## 4. 为什么不做全自动（爆炸半径）

| 维度 | 分析 |
| --- | --- |
| **链路** | `purposeTick`（桥接进程，60s）→ 提示词 → DSH 会话回合 → 模型调 `dynamic.mjs --go` / `send_qzone_msg` → 公网 |
| **机制风险** | 情绪是**启发式词表 + 手工特征**，`PURPOSE_OUTREACH.md §2.8` 自己写明「换圈子/黑话需要补词」「不是训练出来的语义模型」。把启发式判断直接变成公开发言，等于把误判概率放大到公共面 |
| **不可逆性** | B站动态可删但已推送/可能被转发；qzone 可删可改权限，但好友可能已看到。**发布 ≠ 私聊，没有「撤回」这个动作** |
| **读者数** | 私聊 1 人 → 动态「所有访客」/ qzone「好友或所有人」。按 §1.6 的判据，读者数放大 + 静默失败代价=3 |
| **账号风险** | B站有风控（wbi 签名、频率），qzone 属非官方接口；触发风控可能波及**同一个 QQ 登录态**——而 QQ 登录态是 SnowLuma 与整个桥接的命根子。这是「为一个小功能赌主业务」 |
| **隐私** | 人格卡/记忆卡里含主人信息与群友事；B站侧有 `assertOutboundIdentitySafe` 硬拦，qzone 侧**还没有任何闸** |
| **成本** | 每轮生成约等于一次目的回合的 token；每日上限必须硬性 ≤1，否则账单与风控双爆 |

**一句话**：这不是代码 bug，是产品风险。全自动的收益是「更像活人」，代价是「可能用主人的账号公开发错话」——不对等。

---

## 5. 建议的分阶段落地（只写方案，不实现）

### M1：B站「心情草稿」→ 人工确认发布（首选）

```text
purposeTick（已有，60s）
  └─ 情绪/驱动达阈值 && 今天没发过 && 非安静时段 && 未沉默模式
       └─ 在 owner 会话跑一轮，产出草稿（≤100 字，符合四类动态长度门禁）
            └─ 写 state/emotion-drafts.json（不发布）
                 └─ 设置页「今日心情」卡片：预览 / 发布 / 丢弃
                      └─ 点「发布」→ dynamic.mjs post --go（复用额度闸 + 身份闸）
```

闸门（缺一不发）：`purpose.enabled` · 情绪阈值 · 每日 ≤1 · 安静时段 · 沉默逛 B站 · 额度闸 · 身份闸 · 草稿需人工点发布。

### M2：QQ空间「仅自己可见」的说说

- bridge 新增一个 action（`sendQzoneMsg`），只封装 `content` + `ugc_right`（默认仅自己可见），**图片先不做**；
- **先不暴露给模型**：只给设置页/控制台用，减少模型滥用面；等 M1 稳定再评估是否给模型；
- 复用同一套额度闸与出站身份闸（qzone 侧目前**零闸**，这是硬前提）；
- 验收：自己空间能看到、能删、`ugc_right` 生效。

### M3（可选，2 周后再议）

M1/M2 稳定且主人认可文案质量后，才评估「好友可见」或「公开」。**默认永远不是公开。**

### 配置草案（不实现，仅示意）

```json
"emotionPublish": {
  "enabled": false,
  "targets": { "biliDynamic": true, "qzone": false },
  "requireApproval": true,
  "dailyMax": 1,
  "minEmotionScore": 0.6,
  "allowedEmotions": ["amused", "proud", "excited", "lonely"],
  "quietStart": "23:30", "quietEnd": "08:30",
  "qzoneUgcRight": "self"
}
```

默认 `enabled:false` + `requireApproval:true`，与 OPT-001 的「默认关闭」风格一致。

---

## 6. 风险台账

| 风险 | 触发条件 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 发布错话/泄露主人信息 | 情绪误判 + 文案含身份信息 | 公开面不可撤回 | 人工确认（M1）；`assertOutboundIdentitySafe` 扩展到 qzone；提示词明确禁止提主人/群友 |
| 账号风控/封禁 | 频率过高、非官方接口、异常 UA | 连累 QQ 登录态 → 桥接全挂 | 每日 ≤1；复用额度闸；qzone 先仅自己可见；失败即停不重试轰炸 |
| 情绪被「伪造」 | 素材不足仍硬发 | 人设崩塌 | 保留 `【状态】跳过`（purpose 已支持 silent）；素材不足不发 |
| 重复/刷屏 | 与四类动态、群内分享撞车 | 观感差 | 与 `daily-dynamic.json` 共用间隔（已有 `dynamics.gapMin`） |
| token 成本 | 每轮一次生成 | 账单上升 | 每日上限 1；复用现有 token 额度闸 |
| 失败静默 | API 报错只写日志 | 主人不知道没发出去 | 按 `ERROR-REPORTING.md`：`ok:false` + `code/error/hint`，设置页红字可见 |
| 合规 | 自动生成内容对外发布 | 平台规则/法律风险 | 人工确认 + 默认关闭 + 仅自己可见 |

---

## 7. 验证与回滚（若批准实施）

```powershell
# 只读验证：不发布
node plugins/surfcore/tools/commands/dynamic.mjs post --text "测试" --dry
# 单测（新增）
node scripts/test-emotion-publish.mjs
npm run test:audit
cd plugins/surfcore; npm test
```

真机验收顺序：设置页看草稿 → 丢弃 → 再生成 → 发布 → `dynamic.mjs check --id` → `rm` 删掉。

回滚：
- 软回滚：`emotionPublish.enabled=false`（默认就是关）；
- 硬回滚：删除新 action / 卡片 / state 文件；`state/emotion-drafts.json` 可直接删；
- qzone：`delete_qzone_msg` 删帖，`set_qzone_msg_right` 改权限（不依赖代码回滚）。

---

## 8. 未核实（需要真机或协调会话确认）

1. **`ugc_right` 的取值语义**：SnowLuma 目录只给了参数名，没给枚举。需真机确认「仅自己可见」对应哪个值——**这是 M2 能不能安全开始的前提**。
2. **SnowLuma 当前版本是否真的实现了 qzone action**：`_snowluma-catalog.json` 是仓库里的快照，不等于运行时；需 `qq_status`/真机探一次。
3. **qzone 发图上传**：`images` 参数存在，但上传链路未验证（本方案先不做图）。
4. **B站 `w_rid` 失效表现**：`dynamic.mjs` 每次现取 wbi 签名，但算法随站点变动；失败时的用户可见提示目前只有 CLI 输出。
5. **四类动态与心情动态的额度是否共用**：`daily-dynamic.json` 的键是按 kind 存的，新增一类是否需要独立计数。
6. **qzone 侧没有任何出站身份闸**：现有 `assertOutboundIdentitySafe` 只覆盖 B站 动态，扩展到 qzone 必须先做，否则 M2 一上线就是裸奔。

---

## 9. 结论与需要裁决的三件事

**结论**：OPT-003 值得做，但要做成「**情绪提议、主人拍板**」的半自动形态；**B站先做、qzone 后做、公开面最后**。

需要协调会话/用户裁决：

1. **M1 做不做**（B站草稿 + 一键发布，默认关闭）；
2. **qzone 的默认可见性**：仅自己可见（建议）/ 好友可见 / 不做；
3. **是否接受「必须人工点发布」**——如果要求全自动，本评估的结论是「不做」而不是「想办法做」。

---

## 10. 附：这次评估没有改任何代码

```text
git status               → 只有本文件 + backlog 一行状态
test:audit               → 未重跑（无代码改动，基线仍为 143/143）
运行时影响                → 无（未改 config.json，未重启桥接，未发任何动态/说说）
```
