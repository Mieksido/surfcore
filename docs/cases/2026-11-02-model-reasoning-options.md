# 思考强度可调 + 桥接模型下拉

日期：2026-11-02

## 1. 现象

- 用户以为推理等级只能 `max`，觉得太烧；
- 新设置页只有一个文本框，提示还写了后端不支持的 `medium`；
- 桥接模型固定为 `deepseek-flash`，用户想换模型只能手改 `config.json`。

## 2. 结论

- **`low` 本来就支持**：`dsh.reasoningEffort` 合法值是 `low / high / max`，默认 `max`；旧控制台已有下拉，只是新设置页没露出来。
- **模型可以加选项**，但必须从 DSH `session/modelCatalog` 动态生成，不能硬编码。
- 换模型有四个硬约束：
  1. `selectModel` 会同时改 DSH 全局默认模型（Web GUI 新会话）；
  2. 纯文本模型不支持图片，QQ 媒体要文字兜底；
  3. 不同模型支持的 reasoning 档位不同；
  4. 不同模型价格差很大。

## 3. 改动

### 后端

- 新增 `src/model-options.js`：
  - `catalogChoices()` 整理目录：provider/model、图片能力、efforts/defaultEffort、价格档位；
  - `findCatalogModel()` 精确查目录。
- `GET /api/dsh/model` 增加 `models[]` / `providers[]`；目录失败时返回空数组，不伪造选项。
- 新增 `POST /api/dsh/model`：
  - 只接受目录里的 provider/model；
  - 校验该模型支持的 effort；
  - 写 `config.json`，更新 `cfg.dsh`，`modelSelectionEpoch++`；
  - 返回 `imageInput`、`price`、`globalSideEffect`、`warnings`；
  - 失败返回 `MODEL_REQUIRED` / `MODEL_CATALOG_UNAVAILABLE` / `MODEL_NOT_FOUND` / `MODEL_EFFORT_UNSUPPORTED`，都带 `hint`。
- 保留 `POST /api/dsh/effort` 兼容旧控制台。

### 前端

- QQ 页新增「模型与思考强度」卡：
  - 模型下拉来自 DSH 目录，按 provider 分组；
  - 思考强度 `low / high / max`，low 标注“最省”；
  - 显示“支持图片 / 仅文本 / 未知”、价格档位；
  - 明确提示“会同时修改 DSH 全局默认模型”；
  - 目录不可用时只允许调思考强度，不允许瞎选模型；
  - 保存成功走固定 toast（长页面可见）。
- 移除高级设置里 `dsh.provider` / `dsh.model` / `dsh.reasoningEffort` 三个手填项，避免两个入口打架。

## 4. 生效/风险

- 保存后**下一条消息**生效，无需重启 DSH / 桥接。
- 切模型会改 DSH 全局默认模型，不只 QQ。
- 纯文本模型：图片/表情工具走文字兜底。
- 目录不可用时不能换模型，但可单独调思考强度。
- 默认仍为 `max`；没有替用户自动降档，避免悄悄变笨。
- 价格档位来自本地价目表；未登记模型显示“价目表未登记”，不猜。

## 5. 验证

```text
node scripts/test-model-options.mjs
node scripts/test-audit-bridge.mjs
node plugins/surfcore/scripts/test-client-contract.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
