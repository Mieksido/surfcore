# 语音包离线导入：校验、备份、复制与错误可见

- **日期**：2026-10-29
- **触发**：本地语音包安装依赖太慢，准备用网盘分发预装环境；需要“导入离线包”而不是只改安装目录。
- **结论**：新增离线包导入链路（local/cloud 共用），默认复制不移动源目录；旧包先备份，失败可回滚；所有失败带 `code/error/hint/missing`，设置页弹窗给下一步。

## 1. 现象

- 设置页只有「已有安装？手动指定包目录」，它只写 `voicePacks.dir`，不校验、不复制、不改 `pyvenv.cfg`。
- 路径写错时仍提示“✓ 已指向…”，刷新后卡片显示「未安装」——**静默失败**。
- 直接复用 `install()` 会跑 `postInstall`（pip / fetch-models），不是离线导入；离线包导入后会重新等 20~40 分钟。
- 离线 zip 里的 `.venv/pyvenv.cfg` 是构建机绝对路径；不改写的话，用户解压后解释器找不到 `runtime/`。

## 2. 根因

1. 只有“安装源”概念，没有“已解压离线包 → 标准目录”的导入动作；
2. 状态判断只看 `config.toml` 是否存在（`statusOne`），目录不完整也会被当成“已安装/未安装”，没有结构校验；
3. 错误响应只有 `{ok:false,error}`，插件 `api()` 只保留 `message`，`code/hint/missing` 在传输层丢失；
4. 源目录、旧包、目标目录三者没有事务边界：复制失败/切换失败可能留下半包。

## 3. 修法

### 3.1 校验层（`src/voice-pack-import.js`）

- `normalizeSourceDir`：选包目录/上一级/多套一层都归一；类型不符给 `IMPORT_PACK_TYPE_MISMATCH`。
- `missingPackFiles`：公共 + local（`.venv-gsv`、vendor、logs/gsv）+ cloud（`voices/age12-cloud`）。
- `readAndVerifyManifest`：`offline-manifest.json` 校验 `pack`、权重路径与 SHA256；哈希不符直接拒绝；没有清单返回 `null`，由导入端要求用户确认“未验证”。
- `copyTree`：递归复制，统计字节进度，支持取消；拒绝符号链接；**默认只复制，不动源目录**。
- `rewriteVenvConfig`：只改 `.venv`/`.venv-gsv` 的 `home`/`executable`，指向最终目录的 `runtime/python313|312`。
- `prepareConfig`：旧 `config.toml` 逐字节保留（格式坏则拒绝）；没有旧配置时用包内 `config.toml` 或 `config.example.toml`，并清空云端凭据。

### 3.2 导入事务（`src/voice-packs.js`）

- `inspectImport`：只读检查，返回来源/目标/大小/版本/是否验证/警告，供确认框展示。
- `startImport`：先做同步校验（包类型、结构、manifest、目标端口、旧配置、磁盘空间），再起异步任务；`list()` 暴露 `import.progress/phase/error/code/hint/missing`。
- 复制到 `.import-<id>-<ts>` 临时目录 → 处理配置 → 备份旧包 → rename 到位 → **在最终路径改写 pyvenv** → 写 state。
- 失败：清理临时目录；若已切换，恢复备份；恢复失败单独 `IMPORT_ROLLBACK_FAILED` 并保留备份路径。
- `deleteImportSource` / `deleteImportBackup`：只允许删除本次记录、且不是当前安装目录的路径；源目录默认保留。

### 3.3 接口与 UI

- 桥接新增：
  - `POST /api/voice/packs/import-inspect`
  - `POST /api/voice/packs/import`
  - `POST /api/voice/packs/import-cancel`
  - `POST /api/voice/packs/import-delete-source`
  - `POST /api/voice/packs/import-delete-backup`
- 结构化错误：`{ok:false, code, error, hint, missing?, detail?}`；插件 `api()` 保留 `code/hint/missing`。
- 设置页：本地/云端卡片都有「导入离线包…」；先弹确认（类型/来源/目标/大小/版本/完整性），再显示进度与取消；失败用 `ErrorModal` 展示错误码、缺失项和“重新选择目录/先停止语音包”等动作；成功后显示“已导入，尚未验证运行”，并提供「启动语音包」「删除源文件夹」「删除旧备份」。
- 删除旧的「手动指定包目录」入口，避免用户继续走静默失败路径。

## 4. 完整逻辑（七步）

1. **链路**：设置页 → `/dsh-surfcore/api/voice/packs/import-inspect` → 插件 `handleVoice` 代理 → 桥接 `/api/voice/packs/import-inspect` → `createVoicePacks().inspectImport`；确认后同样走 `import`，后台任务写 `activeImports`，`GET /api/voice/packs` 轮询进度。
2. **机制**：`sourceDir` 视为只读；复制到临时目录后再做环境/配置修复；旧包 rename 备份，最后 rename 切换，保证任何失败都不会破坏旧包。`pyvenv.cfg` 必须在最终路径改写，否则 home 指向临时目录。
3. **爆炸半径**：只写 `packsDir` 下目标包与 backup；不改源目录、不改 `config.json`、不碰真实用户配置；复制 GB 级文件，需磁盘/时间，但失败可回滚。
4. **取舍**：
   - 默认复制 vs 移动：复制多占 7.4G，但不消耗用户下载备份；移动会违反“源目录只读”的要求。
   - 独立导入 vs 复用 install：install 会跑 pip/fetch-models，离线包必须跳过，故新增链路。
   - 失败弹窗 vs toast：导入耗时且可能破坏旧包，必须弹窗给恢复动作。
5. **生效与重启**：新增桥接路由/模块需要重启桥接；插件 UI 改动刷新 DSH Web 或重启 DSH；导入成功后启动语音包验证。
6. **验证**：`node scripts/test-voice-pack-import.mjs`（9 项：inspect、缺失、类型不符、哈希、无清单拒绝/确认、复制+pyvenv、配置保留+备份、pyvenv 失败回滚、旧配置损坏拒绝）；`npm run test:audit`；`npm run test:regressions`；`plugins/surfcore npm test`。
7. **回滚与残余**：失败自动恢复备份；恢复失败保留 backup 并报 `IMPORT_ROLLBACK_FAILED`；源目录始终保留；仍未做“运行自检”（只做结构/清单检查），成功文案明确“尚未验证运行”。

## 5. 未覆盖/后续

- 导入后的“运行自检”还没做；需要执行包内 Python，默认不跑。
- 无 manifest 的旧包允许导入但需用户确认，成功标记 `verified:false`。
- 真实 7.9G 包已用 `createVoicePacks` 导入到 `D:/surfcore-poc/import-real-packs`：目标 7.6G，源目录保留，pyvenv 指向最终目录；UI 点击/重启桥接仍未手测。
- 取消清理失败会提示残留路径。
- 许可（piper GPL、huayan、微调权重）仍按发布决策处理，导入功能不解决许可问题。
