# 向量记忆：为多个模型重建索引（多选本地/云端）

## 现象

「为三个模型建索引」只能补本地缺失索引，已经有索引的模型看不到状态；
用户想一次选择多个本地/云端模型重建，并提前知道哪些已有索引。

## 修法

### UI

`plugins/surfcore/lib/client.js`：

- 按钮改为「为多个模型重建索引」；
- 点击打开多选弹窗：
  - 本地：bge-small / Qwen3-Embedding / bge-m3；
  - 云端：硅基流动 / 智谱 / 阿里云百炼 / OpenAI；
  - 已安装/已配置才可勾选；
  - 已有索引显示「（已有索引 N 条）」并默认不勾选；
  - 未安装/未配置显示原因并禁用；
  - 「只选未建索引」可一键回到默认。
- 勾选已有索引也会真正重建（不再自动跳过）。

### 后端

`plugins/surfcore/lib/index.js` 新增 `rebuild-selected`：

- `local:<id>`：启动/复用 runtime，注册本地模型，再按该模型 modelSpace 循环重建；
- `cloud:<provider>`：直接使用已保存的 endpoint + key 建索引，不切换全局 active provider，也不要求 runtime 在线；
- 不改变当前 `vectorMemory.provider/model/modelSpace`，只写各模型自己的索引；
- 结果逐项返回 `ok/embedded/indexed/pending/error`。

`plugins/surfcore/lib/embedding-packs.js`：

- `embeddingPacksStatus().cloudConfig.providers` 增加 `indexReady/indexed`；
- 新增内部 `getCloudProviderProfile()` 给服务端直连建索引用（不暴露 key 到客户端）。

## 验证

```text
test:audit 151/151
test:regressions 全部通过
test-vector-memory-wiring 7 pass
test-embedding-packs-plugin 通过
client contract / ui contrast 通过
```

## 未验证

- React 真实渲染（弹窗、勾选、结果）需重启 DSH 后人工看；
- 真实云端多模型建索引（没有可用云端额度）；
- 一次重建多个云端的耗时/失败中途行为；
- 本地多模型重建（4021 条/模型）未在真实数据上全跑。
