# 备份轮转 keep=40 不生效，backups 无限增长

日期：2026-11-02

## 1. 现象

`~/.dsh/surfcore/backups/` 只增不减；报告实例 252 个文件、252 组、每组 1 个，`memory-card-*.json` 101 份占 73 MB。

## 2. 根因

写文件：

```js
`${safe}-${stamp}${ext}`
// memory-card-2026-10-31T10-01-25-880Z.json
```

清理正则：

```js
/^(.*)-(\d{4}-\d{2}-\d{2}T[^-]+)$/
```

两个错误：

1. `[^-]+` 不允许横线，但时间戳被替换成 `10-01-25-880Z`；
2. `$` 要求时间戳后结束，但文件名还有 `.json`。

结果每个文件都退回整个文件名当组名，每组只有 1 个，`slice(keep)` 永远为空。

## 3. 修法

- 新增 `backupGroupOf(name)`：
  - 先 `path.basename`；
  - 去掉扩展名；
  - 用 `/^(.*)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)$/` 解析；
  - 无法识别返回 `null`，不误删用户放进 backups 的无关文件。
- `pruneBackups(keep=40, dir=BACKUP_DIR)`：
  - 按真实来源分组；
  - 每组按 mtime 留最近 keep；
  - 返回 `{removed, errors}`；
  - 清理失败写 `console.warn`，不再静默。
- `backupFile` 失败写 `console.error`，不再只返回 null。
- 新增 `scripts/test-backup-prune.mjs`：
  - 带扩展名/横线时间戳文件名解析；
  - 5 个 memory-card + 3 个 qq-config，keep=2；
  - 无扩展名备份也能分组；
  - 无关文件不被误删。

## 4. 生效/风险

- 重启 DSH 插件后生效；
- 下一次 `backupFile()` 触发立即清理；
- 旧目录会一次性回收，先确认 40 份保留策略符合预期；
- 只清本模块识别出的备份名，未识别文件保留；
- 仍没有备份总大小上限/压缩；大记忆卡 40 份仍可能占几十 MB；
- 仍没有同毫秒冲突保护；
- `keep=40` 仍是硬编码默认，没有 UI 配置。

## 5. 验证

```text
node scripts/test-backup-prune.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
