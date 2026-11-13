# 版本管理

> 一句话：**版本号只有一个来源，发布只认 tag，升级只认快进。**

---

## 一、规则

### 1.1 唯一真相

| 位置 | 角色 |
| --- | --- |
| 根 `package.json` 的 `version` | **唯一真相**，改版本只改这里（用 `scripts/version.mjs bump`） |
| `plugins/surfcore/package.json` | 必须与根一致（脚本自动同步） |
| `plugins/**/package.json`（含 qq-mode 等子插件） | 必须与根一致，`version:check` / `test:version` 会拦 |
| `plugins/surfcore/lib/index.js` | **不许硬编码**，从根 `package.json` 读 |
| `client.js` | 显示用，取 `overview.version`，不写死 |
| `dist/installer` | 不写死版本，安装时取最新稳定 tag |

### 1.2 语义化版本（0.x 阶段）

当前是 `0.x`，约定：

| 动作 | 版本变化 | 例子 |
| --- | --- | --- |
| 破坏性变更（配置结构、工具签名、数据格式） | **minor** | `0.1.3` → `0.2.0` |
| 新功能（兼容） | **minor**（0.x 阶段合并到 minor） | `0.1.3` → `0.2.0` |
| 修 bug / 文档 / 内部重构 | **patch** | `0.2.0` → `0.2.1` |
| 预发布 | `-rc.N` | `0.2.0-rc.1` → `0.2.0-rc.2` |
| 转正式 | 去掉后缀 | `0.2.0-rc.2` → `0.2.0` |

> 到 `1.0.0` 之后，恢复标准 SemVer：breaking = major。

### 1.3 tag 纪律

- 发布 = 打 **注释 tag** `v{version}`（`git tag -a v0.2.0 -m "..."`）；
- **tag 必须等于 `v` + `package.json.version`**；
- tag 之后不应再有"未发布提交"——有就说明该 bump 了；
- GitHub Release 的 tag 名必须与本地 tag 完全一致（`v0.2.0`，不是 `0.2.0`）。

---

## 二、组件版本矩阵

| 组件 | 仓库 | 当前版本 | 版本清单 | 升级方式 |
| --- | --- | --- | --- | --- |
| SurfCore 本体 | `Mieksido/surfcore` | **0.3.0** | git tag | `git` 快进（`--ff-only`） |
| 语音包（本地） | `Mieksido/surfvoicelocal` | **0.1.0** | `models.json` | git 快进 / 拉模型 |
| 语音包（云端） | `Mieksido/surfvoicecloud` | **0.1.0** | `models.json` | git 快进 / 拉模型 |
| 桌宠 | `Mieksido/surfpet` | **0.2.0** | `version.json` | 下 zip → sha256 → 替换 |

### 兼容性约定

| 组合 | 要求 |
| --- | --- |
| SurfCore ↔ 桌宠 | 桌宠 `version.json` 协议 **v1**（`{version, notes, file:{url,sha256,size}}`）；SurfCore ≥ 0.1.0 可读 |
| SurfCore ↔ 语音包 | 语音包提供 `/v1/speak/file`；`models.json` 支持 `archives[]`（v1） |
| 桌宠 ↔ 语音 | 桌宠只读 SurfCore 的语音设置，不直连语音包 |

> 破坏上面任一协议 = **SurfCore minor bump**，并在 CHANGELOG 的「破坏性变更」里写明。

---

## 三、日常操作

```bash
node scripts/version.mjs show          # 看版本矩阵（本地 + 兄弟仓库）
node scripts/version.mjs check         # 一致性校验（提交前 / CI）
node scripts/version.mjs bump patch    # 0.1.0 → 0.1.1（修 bug）
node scripts/version.mjs bump minor    # 0.1.1 → 0.2.0（新功能/破坏性）
node scripts/version.mjs bump rc       # 0.2.0 → 0.2.0-rc.1（预发布）
node scripts/version.mjs tag --push    # 打 tag 并推送
```

`check` 会验证：

- 根与插件 `package.json` 版本一致；
- 代码里没有硬编码版本；
- `CHANGELOG.md` 有当前版本的小节；
- 最新 tag 与版本号一致（没有就警告）；
- tag 之后没有未发布提交（有就警告）。

---

## 四、发版清单（照着打勾）

```text
[ ] 1. node scripts/version.mjs bump {patch|minor|rc}
[ ] 2. 补 CHANGELOG.md 的对应小节（新增/变更/修复/破坏性）
[ ] 3. npm run test:audit          # 76 项全绿
[ ] 4. cd plugins/surfcore && npm test
[ ] 5. git add -A && git commit -m "release: vX.Y.Z"
[ ] 6. node scripts/version.mjs tag
[ ] 7. git push origin main && git push origin vX.Y.Z
[ ] 8. GitHub → Releases → 用 tag 建 Release（正文从 CHANGELOG 抄）
[ ] 9. 桌宠/语音包：make-manifest / make-models 重新生成 version.json / models.json，上传资产
[ ] 10. 发布后跑一次 设置 → 概览 → 检查更新，确认新版本能被识别
```

---

## 五、回滚

发布出问题时的顺序（从不破坏数据开始）：

1. **先回滚更新源**：把 GitHub Release 标成 draft / 删掉，用户那边更新面板就不会再提示；
2. **再回滚代码**：`git revert <坏提交>` → bump patch → 重新发版（**不要** force push tag）；
3. **用户侧**：设置页概览 → 更新 → 若已更新，用仓库里的 `_backups/` 或 `git checkout v上一个tag` 回到旧版，然后重启 DSH；
4. **数据**：`config.json` / `state/` / `~/.dsh/surfcore/` 都不在 git 里，更新从不覆盖它们。

> 绝不删除已发布的 tag——用户可能已经拉过；只能往前发新版本。

---

## 六、为什么不用 `npm version`

`npm version` 会顺手 `git commit` + 打 tag，但它：

- 只改根 `package.json`，不会同步插件那份；
- 不会更新 `CHANGELOG.md`；
- 不会检查"代码里还有硬编码版本"。

所以这里用 `scripts/version.mjs` 统一管，`npm version` 不要用。
