# 语音包被误放进 zip 自动更新：永远无法自动更新

- **日期**：2026-10-30
- **反馈**：语音包仓库没有 `package.json`，SurfCore 的 zip 更新流程一直判定“无法自动更新”。
- **结论**：语音包不是 SurfCore 代码包，**不该进入通用 zip 自动更新**；正确做法是手动重新导入离线包。

## 1. 链路

```
设置 → 概览 → 更新卡
  └─ updates.components()
       ├─ SurfCore 本体（git / zip）
       ├─ 语音包（原本 kind:auto，versionRepo）
       └─ 桌宠（release / version.json）
             ↓
inspectComponent → channel:version → updateFromZip()
             ↓
解压后要求 surfcore-* 根目录 + package.json + release/install-manifest.json
```

语音包实际是：

```
surfvoicelocal-main/
  version.json
  models.json
  config.example.toml
  voxd/ run.bat ...
```

没有 `package.json`，根目录名也不是 `surfcore-*`，所以必然在 `verify.bad-archive` 失败。

## 2. 机制

- `updateFromZip()` 是给 SurfCore 本体写的：`/^surfcore-/`、`package.json`、安装清单；
- 语音包是离线运行时/模型/vendor 包，不是代码 zip；
- 即使补 `package.json`，还缺安装清单、config/venv/models 保留逻辑；
- 之前把它登记进 `updates.components()` 是抽象错误，不是“缺一个文件”。

## 3. 爆炸半径

- 仅更新面板：语音包不再显示“可更新”，不会下载 4.7G 后失败；
- 语音页仍保留“导入离线包…”；导入事务本来就保留 `config.toml/.venv/models/vendor`；
- 不改语音包仓库、不改公开镜像。

## 4. 取舍

- **A：语音包退出自动更新，语音页手动重新导入**（本批采用）。
- **B：给语音仓库补 package.json + 安装清单 + 写 voice 专用 updater**（成本高，GitHub 归档也不含大模型/vendor，暂不做）。
- **C：只补 package.json**（不改根目录/清单，仍然失败；不选）。

## 5. 生效与重启

- 插件代码改动；重启 DSH 后更新列表里不再出现语音包；
- 语音页新增说明：“语音包不参与检查更新，需要新版本时用重新导入”。

## 6. 验证

```bash
cd plugins/surfcore && npm test   # test-updates-voice 钉住：不再登记 surfvoice 组件 + 语音页说明
npm run test:audit                # 89/89
```

## 7. 回滚与残余

- 回滚：恢复 `components()` 里两个语音包条目即可；无数据迁移。
- 残余：语音包没有自动版本检查/通知；需要用户自己从网盘/Release 重新导入。
  以后若做，应走独立“语音包版本检查 + 手动导入”，不要复用 `updateFromZip`。
