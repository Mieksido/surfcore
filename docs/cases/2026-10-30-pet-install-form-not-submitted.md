# 2026-10-30 · 桌宠：填了安装目录点「安装」仍报「请先填写安装包地址」

## 现象

- Electron 已下载成功（238 MB），安装目录填了 `/dswork/pet`，点「安装」立即失败；
- `pet/config.json` 的 `source` / `appDir` 都是空；
- `pet/app` 不存在，`plugin.log` 里没有任何 install 记录。

## 根因

1. **表单从未提交**：前端 `POST /pet/install` 的 body 是 `{}`，后端 `petService.install()` 不接收参数，
   实际读的是持久化的 `cfg.source`（空）→ 直接返回错误。安装目录输入框也没有保存路径。
2. **Windows 路径无校验**：`/dswork/pet` 会被 `path.resolve` 解析到"当前盘"，不是用户想的 D 盘。
3. **错误文案不指字段**：用户刚填的是目录，却看到"请先填写安装包地址"，没有 code/field/hint。

## 修法

| 层 | 改动 |
| --- | --- |
| 前端 | 安装请求带 `{source, appDir, electronPath}`；启动请求带 `{electronPath}`；安装目录下方提示"Windows 请填带盘符路径" |
| 后端 | `/pet/install`、`/pet/start` 接收 body；`install(source, patch)` 先把表单落盘再执行 |
| 校验 | `checkAppDir` 在 Windows 下要求盘符：非 `X:\` 开头 → `code=pet.path-no-drive` + hint |
| 错误 | `source` 为空 → `code=pet.source-missing`、`field=source`、hint 指向「用官方最新版」 |

## 验证

- 新增 `test-pet-install-form`：盘符校验、空地址结构化错误、表单落盘、前端/后端契约；
- `npm test`（插件）全绿；`npm run test:audit` 85/85。

## 教训

**"表单即配置"的界面，动作请求必须显式带表单**，否则用户填了也不会生效；这类接线错误要用契约测试钉住。
