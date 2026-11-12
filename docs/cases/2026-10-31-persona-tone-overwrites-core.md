# 2026-10-31 · 点「保存全部」人格核心被清空/覆盖

## 现象

新版角色页（四层人格）里改完人格点「保存全部」，人格核心内容被清空（有的用户表现为
核心变成语气层的内容）。用户以为“改老角色必须新建角色”。

## 根因（服务端契约缺失 + 客户端盲写）

1. `handlePersona` 的 `layerPaths()` 只返回 `core / daily / scenes`，**没有 tone**；
2. POST 分支只处理 `daily` / `scene`，`layer === 'tone'` **没有分支**，落到默认 `target = paths.core`；
3. GET `/persona` 的 `layers` 也不返回 tone → 客户端 `draft.tone` 永远为空；
4. 客户端「保存全部」无条件把四层都发出去（tone 为空也发）→ 服务端把**空语气写进 persona.md**，
   或把拆分出来的语气内容**覆盖到核心**。

所以不是“不能改老角色”，是保存契约里 tone 层根本没落地，写错了文件。

## 修法

| 层 | 改动 |
| --- | --- |
| 服务端 | `layerPaths()` 补 `tone`；POST 增加 `layer === 'tone'` → 写 `persona.tone.md`；GET `layers` 返回 tone |
| 客户端 | 「保存全部」只写：核心（必写）+ 其他层“有内容”或“原本有内容被清空”的层；不再盲写空 tone/daily/scene |
| 安全 | 未知 layer 仍默认 core（兼容旧调用），但已知层不会再串到 core |

## 验证

- `test-persona-layers` 新增回归：服务端必须有 tone 分支、层路径含 tone、GET 返回 tone 文本、客户端保存前知道原层内容；
- audit 107/107；插件测试全绿。

## 用户恢复

- 角色页 →「人格卡历史备份」→ 恢复最近的 `persona-*` 备份；
- 人格卡文件在角色包内：`characters/<id>/persona.md`（核心）、`persona.tone.md`、`persona.daily.md`、`persona.scenes/*`。

## 教训

**多层的保存契约必须逐层显式落地**：默认分支写 core 很危险——新增一层忘了分支，就会把别的层覆盖到核心上。
客户端也不该“空值也提交”，空值语义（清空 vs 不存在）要在协议里说清楚。
