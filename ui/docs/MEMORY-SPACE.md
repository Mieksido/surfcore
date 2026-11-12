# 记忆空间（只读 3D 投影）实现与设计

> 前端：`surfcore-ui`；后端：`D:\deepseekwork\surfcore`（只读，不改）。
> 状态：**已接入（UI v0.29.0）**。后端 `GET /vector/space?modelSpace=…&limit=800` 已返回 PCA3 坐标；UI 做惰性加载 + Canvas 3D 投影。
> 原则：没有接口就标「待接入」，不用文本相似度/随机坐标冒充千维空间。

---

## 0. 实现摘要（UI v0.29.0）

- 位置：向量记忆 → 第五个子 tab **记忆空间**（记录检索右边）。
- **默认不加载**：进入 tab 只显示模型选择器 + 「查看空间」；选中模型并点按钮后才请求 `/vector/space`、才创建画布。
- 模型列表来自 `/vector/status.spaces`，只列 `indexed > 0` 的 space；维度从 `/vector/models` 补。
- 画布：Canvas 2D 做 3D 透视投影，不引入 Three.js；拖拽旋转、滚轮缩放、悬停摘要、点击详情（含投影坐标 x/y/z）。
- 元数据：`modelSpace/dim/method/explained/total/eligible/hidden/returned/sampled`。
- 只读：没有写按钮；不读 state 文件；不拿 `/library` 的 score 当坐标。
- 门禁：`overview.capabilities.projection`；false 或 overview 不可用时禁用并说明原因。
- 状态：loading / ready / empty / failed / unknown / unavailable；错误按 `code/message/hint` 显示。
- 文案：顶部两句大白话——「怎么画的：挑 3 个最能拉开差距的方向，把高维压成 3 维。」「能干什么：只读观赏，像看星图；转一转、点一点，改不了任何东西。」；PCA3 是降维近似，坐标是展示坐标，不是原始千维向量；`explained` 总和低时提示“只保留部分结构”。

---

## 1. 为什么现在做不了“真”的

| 现有接口 | 能给什么 | 缺什么 |
| --- | --- | --- |
| `GET /vector/status` | spaces、indexed/pending/failed、modelSpace | 没有每个点的坐标 |
| `GET /vector/models` | 模型/dim/indexReady/size | 没有索引内记录 |
| `GET /library` | 记录文本、时间、频道、相似度 score | **没有原始向量，也没有 3D 坐标** |
| 索引文件 | `.bin` 里有 1024 维 float | UI 不能读 state 文件；浏览器也拿不到 |

`/library` 的 `score` 是“与某条查询的相似度”一个标量，不是坐标；用多个查询反推坐标属于伪造，不能做。

---

## 2. 需要后端补的只读接口（建议）

### 2.1 空间清单

可以复用现有数据拼，不必新增：

```text
GET /surfcore-api/memory/vector/status  → spaces: { [space]: {indexed,pending,failed} }
GET /surfcore-api/memory/vector/models  → local/providers 的 dim/modelSpace
```

UI 用两者合并出“可选择的模型空间”（有索引 + 有维度 + 点数）。

### 2.2 投影坐标（关键新增）

```http
GET /surfcore-api/memory/vector/space?modelSpace=<space>&limit=800
```

```json
{
  "modelSpace": "bge-m3@1024-f16-v1",
  "model": "bge-m3",
  "dim": 1024,
  "method": "pca3",
  "explained": [0.23, 0.14, 0.08],
  "total": 1200,
  "returned": 800,
  "sampled": true,
  "generatedAt": 1700000000000,
  "points": [
    {
      "id": "vm_…",
      "x": -0.42, "y": 0.18, "z": 0.77,
      "importance": 63,
      "at": 1700000000000,
      "channel": "qq / group / 群名",
      "text": "截断到 200 字以内的记忆正文"
    }
  ]
}
```

要求：

- **后端投影**（PCA3 / UMAP3 均可），不要返回 1024 维原始向量：800 条 × 1024 float 的 JSON 约 3–10 MB，且前端做投影会卡。
- 坐标归一化到 `[-1,1]` 或任意统一尺度，UI 只负责缩放。
- `sensitive !== true` 过滤；owner/admin 视图；不返回媒体。
- 采样：默认最多 800–1000 点；`sampled:true` 时 UI 明示“采样展示”。
- 按索引 manifest 的 `updatedAt + count` 缓存；重建/编码后失效。
- 错误：`vector.space-unknown`(400)、`vector.index-missing`(404)、`memory.projection-not-wired`(501，未实现时)。
- 可选：`GET /vector/space/:modelSpace/meta` 返回方法/解释方差，避免重复拉点。

> 不建议的替代：`GET .../raw?limit=` 返回原始向量。只适合开发调试，不适合 UI。

---

## 3. UI 设计

### 3.1 位置

- 顶层仍是：**叙事记忆 / 向量记忆**。
- 向量记忆子 tab：总配置 / 本地模型 / 服务商模型 / 记录检索 / **记忆空间**（第五个，排在记录检索右边）。
- 不新增顶层 tab，避免又出现“第三套存储”的误解。

### 3.2 页面结构

```text
记忆空间（只读）
├─ 顶部：模型空间选择器（只有有索引/有点的空间）
│        [bge-m3@1024-f16-v1 · 1024维 · 1200点 · 已采样800]
├─ 工具：[载入空间] [重置视角] [自动旋转 开/关]
├─ 画布：3D 点云（Canvas 2D 透视投影，无外部依赖）
│        · 拖拽旋转 / 滚轮缩放 / 悬停提示 / 点击选中
│        · 选中卡片：时间、频道、重要度、正文
├─ 图例：颜色=重要度（低→高），大小=新近度；坐标轴 X/Y/Z
└─ 注：PCA 投影只保留部分结构；不是原始 1024 维
```

### 3.3 状态

| 状态 | UI |
| --- | --- |
| `loading` | 画布骨架 + 「正在计算/读取投影…」 |
| `ready` | 点云 + 可选列表（前 20 条，便于查找） |
| `empty` | 「这个模型还没有可展示的记录」 |
| `failed` | `code/message/hint` + 重试 |
| `unknown` | 「状态未知」+ 重试 |
| `unavailable` | 「后端待接入：缺少 /vector/space 投影接口」 |
| 模型空间为空 | 选择器空态：「先重建/编码一个模型索引」 |
| `sampled:true` | 顶部明示「采样 800/1200 条，不是全部」 |

### 3.4 性能

- 点云上限 800–1000；Canvas 2D 足够，不需要 Three.js/WebGL 依赖。
- 只在拖拽/缩放时跑 `requestAnimationFrame`；静止时停止；卸载停止。
- `devicePixelRatio` 上限 2；窗口 resize 重新适配。
- 不在每帧画文字；悬停才画 tooltip。
- `prefers-reduced-motion`：默认不自动旋转。
- 后端投影结果缓存；UI 不重复请求同一 `modelSpace + manifest updatedAt`。

### 3.5 只读边界

- 没有写按钮；没有“重新投影/重建”入口（重建仍在总配置）。
- 不读 state 文件、不读构建快照。
- 不把 `score` 当坐标；不随机生成点。

---

## 4. 工作量与“吃配置”

| 部分 | 估计 | 风险 |
| --- | --- | --- |
| 后端 PCA3 + 采样 + 缓存 + endpoint + 测试 | 1–2 天 | 1024×1200 的特征分解；用幂迭代/协方差矩阵即可，CPU 可接受；注意别在主线程阻塞桥接 |
| UI 画布 + 旋转/缩放/悬停/选中 + 状态 + 测试 | 约 1 天 | Canvas 2D 无新依赖；点多时只画点，不画文字 |
| 前端性能 | 轻 | 800–1000 点、Canvas 2D 没问题 |
| 后端性能 | 中 | 投影计算 + 缓存；索引重建后重算一次 |

真正“吃配置”的是**后端投影**，不是前端渲染。若后端用 UMAP，需要额外依赖/训练时间；PCA 最稳。

---

## 5. 建议路径

1. **先让后端加 `/vector/space`**（哪怕先只支持 PCA3 + 800 点采样 + 缓存）；返回上面的字段。
2. UI 再做「记忆空间」tab；接口未就绪时显示「待接入」，不做假点云。
3. 可选增强：按模型空间对比（两个 space 并排/切换）、按时间/重要度过滤、点选后“查看该记忆在叙事卡里的位置”（需要额外接口）。

**不推荐**为了先看到效果而用 `/library` 文本相似度造 3D 布局：那只是“语义相似度地图”，不是千维向量空间，容易误导。
