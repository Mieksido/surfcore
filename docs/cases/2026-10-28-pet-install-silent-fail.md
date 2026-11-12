# 2026-10-28 · 桌宠点「安装」一直无效（无报错）

## 现象

- 用户在「桌宠 → 安装设置」里填 `E:\main.zip`，点「安装」一直没反应；
- 状态一直「未安装」，也没有看到报错。

## 根因（三处叠加）

1. **只认根目录有 `package.json` 的包**
   `doInstall()` 把 zip 直接解压到安装目录，然后 `appPackage()` 只读 `<appDir>/package.json`。
   GitHub 源码 zip 解压出来是 `surfpet-main/package.json`（多一层）→ 必然失败。
2. **失败残留 + 安全闸 = 之后每次都失败**
   第一次失败会在目录里留下 `surfpet-main/`，但安装标记（`.surfcore-pet.json`）只在成功时写。
   第二次点安装时 `checkAppDir(..., allowNonEmpty: ownedByUs())` 判「目标目录非空且看不到安装标记」
   → 直接拒绝，表现就是"点了没反应"。
3. **报错位置不显眼**
   错误渲染在「运行状态」卡片里，而用户是在下面的「安装设置」点按钮；页面长又没自动滚动，很容易错过。

`E:\main.zip` 大概率是 **SurfCore/surfpet 的源码包**，本来就不能当桌宠安装包用。

## 修法（v0.6.17）

- **A. 单层目录自动拍平**：解压后若只有一个顶层目录且其中有 `package.json`，把内容提上来；
- **B. 识别下错包**：看到 `plugins/surfcore`、`dsh/agent-presets` 或 `package.json` 的 name 是 surfcore/其它非桌宠
  → 明确报「这是 SurfCore 的源码包，不是桌宠安装包」/「不是 pet-pack.zip」；
- **C. 失败清理本次残留**：失败时删掉刚解压出来的目录，第二次点安装不再被「目录非空」拦住；
- **D. 报错挪到按钮旁**，并给两个补救按钮：「用官方最新版」「清理残留后重试」（新增 `/pet/clean`）；
- **E. 桌宠 zip 也支持下载链路**：安装设置里可选 官方 / gh-proxy / ghproxy。

## 验证

新增 `test-pet-install-guards.mjs`（已加入插件 `npm test`）：

```
✅ 源码风格 zip：安装流程启动
✅ 单层目录被拍平，package.json 到位
✅ SurfCore 源码包：判为失败
✅ 错误文案说明"这是源码包"
✅ 失败后安装目录被清理（下次不会被"目录非空"拦住）
✅ 任意非桌宠 zip：判为失败
✅ 错误文案指出不是 pet-pack
```

另外修了 `test-updates.mjs` 里对「git 更新立即快进」的旧断言（0.6.12 起改为退出后应用）。

## 遗留

- 拍平只处理「恰好一层」；多层嵌套的第三方打包仍会失败（报错已可读）；
- 未在真实用户机器上验证「源码 zip 也能装」的完整链路（测试用的是同类结构）。

> 相关：卸载保留 `data/` 的链路已由 `test-pet-uninstall-keep.mjs` 覆盖（2026-10-28 补）。
