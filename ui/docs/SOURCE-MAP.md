# 来源显示（SourceId → 平台标签）

> 交接依据：`surfcore-persona-core/docs/persona-core/UI-PLATFORM-SOURCE-HANDOFF.md`
> 原则：**内核/适配器只传不透明 `sourceId`；UI 负责翻译。** 组件里不写平台名判断，也不显示原始 ID。

---

## 1. 唯一映射表

文件：`src/lib/source.js`（构建时内联进 `client.js`）。

| sourceId | 显示名 | 符号 | 颜色 |
| --- | --- | --- | --- |
| `src_qq` | `QQ` | `Q` | `#38bdf8` |
| `src_bilibili` | `B站` | `B` | `#fb7185` |
| `src_desktop_pet` | `桌宠` | `宠` | `#a78bfa` |
| `src_web` | `网页` | `网` | `#22d3ee` |
| `src_unknown` | `未知来源` | `?` | `#94a3b8` |

颜色/符号都在映射表里；标签文字保证不是“只靠颜色区分”。

导出的接口：

```js
sourceIdFromLegacy(raw) // 旧值 → SourceId；未知/异常值 → src_unknown，不抛异常
sourceLabel(id)         // SourceId 或旧值 → 显示名；未知 → 未知来源
sourceMeta(id)          // { id, label, glyph, color }；未知 → src_unknown 条目
SOURCE_MAP / SOURCE_LABELS / SOURCE_IDS
```

兼容的旧值（只在这一处判断）：

```text
qq / surfcore@qq / qq / group
bili / bilibili / bili / video / surfcore@bili
pet / desktop-pet / desktop_pet / pet / ...
web / web / ...
src_* 直传
```

---

## 2. 用在哪些地方

| 页面/组件 | 用法 |
| --- | --- |
| 叙事记忆（衰减/全量） | `MemRecordRow` → `MemSourceTag` |
| 记忆库（记录检索） | `MemRecordRow` → `MemSourceTag` |
| 记忆空间 | 悬停摘要 + 选中详情的 `MemSourceTag` |
| 构建时快照行 | `MemRecordRow` → `MemSourceTag` |

`MemRecordRow` 不再显示原始 `channel`；需要上下文时只放在 `title` 里，页面可见文本只有 `QQ / B站 / 桌宠 / 网页 / 未知来源`。

记忆正文里出现 “QQ / B站” 是正文内容，不做过滤。

---

## 3. 构建与测试

`build.mjs` 读取 `src/lib/source.js`，去掉 `export ` 后内联到模板占位符 `/* __SOURCE_LIB__ */`；运行时仍是单个 `client.js`。

```powershell
node build.mjs
node test-source-map.mjs   # 24 项：旧值/未知兜底/显示名/元信息
node smoke.mjs
```

测试覆盖：`qq`、`surfcore@qq`、`bili / video`、`desktop-pet`、未知值、空值、会抛异常的怪对象。

---

## 4. 待后端

- 后端在 `narrative.items[] / library.items[] / vector/space.points[]` 补 `sourceId`。
- 未全量返回前，UI 继续用 `channel/platform` 走兼容映射。
- 后端不把平台名写进逻辑；UI 不请求/读取 state 文件。
