# 前端交接：记忆来源 / 平台代码显示

> 给前端会话。后端：`surfcore-persona-core`。只改 `surfcore-ui`，不要动后端。
> 目标：**内核和适配器只传不透明 `sourceId`，UI 负责把 ID 翻译成“QQ / B站 / 桌宠 / 网页”。**

---

## 0. 一句话

**不要在组件里写平台名，也不要把后端传来的原始 ID 直接显示。**
所有平台显示走一张 **`sourceId → 显示名`** 的映射表；这张表只存在于 UI。

---

## 1. 为什么现在要改

现在 UI 的记忆行/记忆库/记忆空间里，来源可能是这些形态：

```text
qq
bili
surfcore@qq
qq / group
bili / video
```

这些是**外部来源的标识**，不是给人看的标签。

新规则：

```text
内核 / 适配器：只传 sourceId（不透明）
UI：sourceId → 显示名（QQ / B站 / 桌宠 / 网页 / 未知来源）
```

这样以后换渠道、加渠道，内核不用改；UI 只改映射表。

---

## 2. 平台代码表（UI 唯一事实）

建议用稳定、短、不含平台逻辑的 ID：

| sourceId | 显示名 | 说明 |
| --- | --- | --- |
| `src_qq` | `QQ` | QQ 群 / 私聊 |
| `src_bilibili` | `B站` | B站动态 / 视频 / 分享 |
| `src_desktop_pet` | `桌宠` | 本地桌宠 |
| `src_web` | `网页` | web 扩展 |
| `src_unknown` | `未知来源` | 兜底，不显示原始 ID |

**这些 ID 只是 UI 的字典键。**
内核不解释它们，后端也不应该把“QQ”写进逻辑。

---

## 3. 当前接口字段

后端会逐步在记忆相关对象上增加：

```ts
sourceId?: string;   // 例如 "src_qq"
```

涉及：

- `GET /surfcore-api/memory/narrative` → `items[].sourceId`
- `GET /surfcore-api/memory/library` → `items[].sourceId`
- `GET /surfcore-api/memory/vector/space` → `points[].sourceId`
- 以后其他带来源的列表

在 `sourceId` 还没全量返回前，UI 用**兼容映射**兜底。

### 兼容映射（只放在 UI 的 mapper 里）

```ts
function sourceIdFromLegacy(raw?: string): SourceId {
  const s = String(raw ?? '').toLowerCase();

  if (s === 'src_qq') return 'src_qq';
  if (s === 'src_bilibili') return 'src_bilibili';
  if (s === 'src_desktop_pet') return 'src_desktop_pet';
  if (s === 'src_web') return 'src_web';

  // 旧/过渡值
  if (s === 'qq' || s.endsWith('@qq') || s.startsWith('qq /')) return 'src_qq';
  if (s === 'bili' || s === 'bilibili' || s.endsWith('@bili') || s.startsWith('bili /')) return 'src_bilibili';
  if (s === 'pet' || s === 'desktop-pet' || s.startsWith('pet /')) return 'src_desktop_pet';
  if (s === 'web' || s.startsWith('web /')) return 'src_web';

  return 'src_unknown';
}
```

**不要在组件里重复这段字符串判断。**

---

## 4. UI 要改哪里

### 4.1 新增一个独立映射文件

建议路径（按 UI 现有结构放，不强制命名）：

```text
src/lib/source.ts
```

内容至少：

```ts
export type SourceId =
  | 'src_qq'
  | 'src_bilibili'
  | 'src_desktop_pet'
  | 'src_web'
  | 'src_unknown';

export const SOURCE_LABELS: Record<SourceId, string> = {
  src_qq: 'QQ',
  src_bilibili: 'B站',
  src_desktop_pet: '桌宠',
  src_web: '网页',
  src_unknown: '未知来源',
};

export function sourceLabel(id?: string): string { ... }
export function sourceIdFromLegacy(raw?: string): SourceId { ... }
```

### 4.2 记忆相关页面统一用它

| 页面/组件 | 改什么 |
| --- | --- |
| 记忆主页总览 | 来源统计/最近记录不显示原始 `qq` |
| 叙事记忆 → 衰减/全量 | 每行的来源用 `sourceLabel` |
| 记忆库 | 列表的频道/来源用 `sourceLabel` |
| 记忆空间 | 点悬停/选中详情里的来源用 `sourceLabel` |
| 筛选/排序（如果有） | 使用 `SourceId`，不要用平台名做 key |

### 4.3 显示规则

- 有 `sourceId` → 用 `sourceId` 映射
- 没有 `sourceId` → 用 `channel` 等字段走兼容映射
- 映射不到 → **`未知来源`**
- **永远不要**把 `src_qq`、`surfcore@qq` 这种原始值直接展示给用户

### 4.4 颜色/图标

- 可以按 `SourceId` 选色/选图标
- **颜色不能是唯一区分**，必须有文字标签
- 不要把“QQ 蓝 / B站粉”写死在组件里；放在映射表或 tokens 里

---

## 5. 类型与测试

### 类型

```ts
type MemoryItem = {
  // ...
  sourceId?: string;
};
```

UI 内部使用 `SourceId`，不要用裸 `string` 撒到组件。

### 单测（建议）

- `sourceIdFromLegacy('qq') === 'src_qq'`
- `sourceIdFromLegacy('surfcore@qq') === 'src_qq'`
- `sourceIdFromLegacy('bili / video') === 'src_bilibili'`
- `sourceIdFromLegacy('desktop-pet') === 'src_desktop_pet'`
- `sourceIdFromLegacy('什么鬼') === 'src_unknown'`
- `sourceLabel('src_unknown') === '未知来源'`
- 任何未知值都不会抛异常

### 验收

- 记忆页所有来源显示为 `QQ / B站 / 桌宠 / 网页 / 未知来源`
- 页面里搜不到裸 `src_qq` / `surfcore@qq`
- 未知来源不崩溃，不显示原始 ID
- 三个页面（叙事/记忆库/记忆空间）显示一致

---

## 6. 不要做的事

- 不要改后端接口
- 不要在组件里写 `if (platform === 'QQ')`
- 不要把 provider ID（`siliconflow` / `zhipu` / `alibaba` / `openai`）当平台代码
- 不要从颜色反推平台
- 不要用 `channel.split('/')[0]` 直接当显示名；走 mapper
- 不要在 UI 里请求/读取 state 文件

---

## 7. 后端配合

后端会做：

- 在记忆相关返回对象上补 `sourceId`
- 不把平台名写进内核逻辑
- 不改变 event/intent/receipt 结构
- 大适配器继续冻结

UI 先做映射和兜底；等 `sourceId` 全量返回后，删掉兼容分支即可。

---

## 8. 可直接发给前端会话的消息

```text
记忆来源显示要统一改一下：内核/适配器只传不透明 sourceId，UI 负责翻译成 QQ/B站/桌宠/网页。

请只改 surfcore-ui，不动后端。

1) 新增一个独立映射文件（如 src/lib/source.ts）：
   src_qq -> QQ
   src_bilibili -> B站
   src_desktop_pet -> 桌宠
   src_web -> 网页
   src_unknown -> 未知来源

2) 提供：
   sourceLabel(id) 
   sourceIdFromLegacy(raw)：兼容旧的 qq / bili / surfcore@qq / qq / group 等值；
   未知值一律 src_unknown，不抛异常。

3) 记忆主页、叙事记忆（衰减/全量）、记忆库、记忆空间的行/详情，全部走 sourceLabel；
   不要直接显示 src_qq / surfcore@qq，也不要在组件里写平台名判断。

4) 类型统一用 SourceId，不要散裸 string；颜色/图标按 SourceId 放映射表，且不能只靠颜色区分。

5) 加单测：qq、surfcore@qq、bili / video、desktop-pet、未知值。

验收：三个页面来源显示一致；页面无裸 ID；未知来源显示“未知来源”，不崩溃。

后端会在记忆接口补 sourceId；未返回前用兼容映射兜底。
```
