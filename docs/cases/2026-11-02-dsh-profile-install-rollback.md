# DSH 安装后 profile bundles 被裁剪（安装事务回滚）

日期：2026-11-02

## 1. 现象

surfcore 装上后，DSH `profiles/desktop/package.json` 的：
- `dependencies` 还在；
- `dsh.profile.bundles` 只剩 base + web-app；
- 其他 17 个插件全部从 profile 消失。

报告把原因归为“surfcore bundle 加载失败，DSH 重写 profile”。

## 2. 根因（已核对的 DSH 代码）

DSH 0.2.1-rc.5 的 `loadProfileDirectory()` 对失败 bundle 只做：

```js
skippedBundles.push({ packageName, reason });
```

**不改 `package.json`。**  
因此“加载失败导致 DSH 删 bundles”不成立。

更符合现场的是安装事务：

```text
setup-dsh 写 profile package.json
→ dsh plugin install
→ bundle 解析不完整
→ DSH reconcile() 把解析不到的第三方 bundle 全部过滤掉
→ 只剩模板项 base + web-app
```

`reconcile()` 只过滤 `bundles`，不清 `dependencies`，与现场完全一致。

surfcore 安装器原来的问题：

- `package.json` 没有备份（只备份了 `cordis.patch.yml`）；
- 写 profile 不是原子写；
- `dsh plugin install` 失败只打日志，不回滚；
- 安装后不核对 bundles 是否被裁剪。

## 3. 修法（最小风险）

- 写 `package.json` 前自动备份，保留最近 5 份；
- `package.json` / `cordis.patch.yml` 改成临时文件 + rename 原子写；
- 安装前记录 profile 的 bundles/dependencies；
- `dsh plugin install` 后核对：
  - 原有 bundles 一个不少；
  - 原有 dependencies 一个不少；
  - surfcore 留在 bundles；
  - `cordis.patch.yml` 没被安装器改写；
- 任一不满足：
  - 恢复 `package.json` / `cordis.patch.yml` 备份；
  - 以非零退出，明确提示“已回滚”；
- 备份失败直接停止，不继续污染 profile。

## 4. 生效/风险

- 下次运行 `node scripts/setup-dsh.mjs <profile>` 生效；
- 需要 DSH 完全退出后再安装；
- `dsh plugin install` 失败现在会回滚 profile，不会留下“半个 surfcore”；
- 回滚只恢复 profile 两个文件，不恢复 `node_modules` / `pnpm-lock.yaml`；若 pnpm 已破坏依赖，仍需重新 `dsh plugin install`；
- 若用户在安装期间手工改 profile，回滚可能覆盖这些改动；备份带时间戳，可人工恢复；
- 不改变 `QQ_BRIDGE_SKIP_DSH_INSTALL=1` 的离线安装语义。

## 5. 验证

```text
node scripts/test-audit-setup.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
