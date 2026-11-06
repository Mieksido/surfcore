# 2026-11-04 · 记忆页改成「公用设置 + 叙事/向量 Tab」

## 现象

记忆页把所有内容堆在一页：记忆方式、向量模型/Embedding 包、叙事记忆卡、双向同步、审计全混在一起，越加越长。

## 改法（只动 UI 结构，不动后端）

- 顶部保留**公用设置**：叙事记忆 / 向量记忆的选择（`memory.mode`），并说明“切换只改读取/注入，两套存储都继续写”。
- 下面新增记忆页内 Tab（复用 `.qbw-tabs/.qbw-tab`，和 QQ/B 站一级 Tab 一致）：
  - **叙事记忆**：记忆卡摘要、双向脱敏同步、记忆卡规则/全量卡/同步范围/审计；
  - **向量记忆**：Embedding 来源/模型/启用/发现文件、向量状态、整理/重建、三个 Embedding 安装包。
- 切换「记忆方式」下拉时自动跳到对应 Tab；Tab 本身可手动切换。
- 服务端配置异步加载完成后，Tab 跟随当前 `memory.mode`，不会把用户刚点的手动 Tab 覆盖。

## 涉及文件

- `plugins/surfcore/lib/client.js`（仅 `MemoryTab` 渲染结构）

## 验证

```
node plugins/surfcore/scripts/test-client-contract.mjs   ✅
npm run test:audit                                       151/151
plugins/surfcore npm test                                0 失败
```

## 残余

- 没有做浏览器截图/逐屏视觉验收；Tab 复用现有样式，理论上与一级 Tab 一致；
- 向量 Tab 里的“启用向量存储”只是写入 `unified.vectorMemory.enabled`，仍需底部保存生效；
- 没有改任何 API、state 或 manifest 逻辑。

## 修复（2026-11-04 首版白屏）

- 首次实现把 pane 状态误插到 JsonCell 组件，MemoryTab 里引用未定义变量，点记忆页直接白屏；
- 已把 const [pane,setPane] 移回 MemoryTab，并移除 JsonCell 里的误插；
- 复跑 	est-client-contract、	est:audit 151/151、插件测试 0 失败。
