# 2026-11-01 · 引入 dev/main 双分支（A 方案）

## 背景

用户反馈“发版速度过快”，沟通后拍板 **A 方案**：代码与发布之间加一层 `dev` 集货区。

## 分支模型

| 分支 | 角色 | 允许的提交 |
| --- | --- | --- |
| `dev` | 集货区：日常修复/功能/文档 | 随时 commit；**不 bump、不打 tag、不发 Release、不推公开仓库** |
| `main` | 稳定线：只放已发布状态 | ① 发布会话 `merge --no-ff dev`；② `hotfix/*` 立即 patch 后回并 dev |

## 发布会话流程

```bash
git checkout main
git merge --no-ff dev
npm run test:audit && (cd plugins/surfcore && npm test)
node scripts/version.mjs bump patch|minor
# 更新 CHANGELOG → 提交 release
node scripts/release-manifest.mjs && --verify-ref HEAD
# 镜像同步 → tag → publish → 真实归档核对 → GitHub Release
git checkout dev && git merge --no-ff main   # 发完回合并，防止漂移
```

## 关键约束

- 三条发布门禁不变，只是**在 main 的发布提交上**执行；
- 公开仓库/镜像只同步 `main`；zip 用户不会拿到 dev 半成品；
- 需要志愿者测试时发 **GitHub Pre-release**（`-dev.N`）；更新器用 `/releases/latest`，天然忽略 prerelease；
- 热修（安全/数据丢失/完全不可用）不等待批次：`main → hotfix/* → patch → Release → 回并 dev`；
- dev 与 main 的漂移用“每次发版后 main 回并 dev”控制。

## 当前状态

- `main` 已重置到已发布的 `v0.8.6` 状态（`42ec20d`）；
- `dev` 在其之上，包含未发布的「DSH 注册修复按钮」等提交；
- 之后的编辑提交一律落 `dev`。

## 教训

“改得快”不该等于“发得快”。用分支把**代码节奏**和**用户更新节奏**解耦，
同时保留 hotfix 通道，才能既不拖修复、又不折腾用户。

## 追加：更新通道（stable / dev）与 dev 构建

- 更新器新增 `updates.channel`（默认 `stable`）：stable 只走 `/releases/latest`，dev 只筛选 Pre-release 的 `-dev.N`；
- 版本规则：stable `0.8.6`；dev 构建 `0.8.6-dev.1 / .2 …`，同号下低于正式版；
- 从正式版切到 dev 时允许安装一次（`channel-switch`），之后按 semver 比较 dev 构建；
- 设置页「检查更新」下面单选 **main（正式版）/ dev（测试版）**；切通道会清空旧检查结果，main 不会被 dev pending 弹窗打扰；
- 发布 dev：`node scripts/publish-dev.mjs --yes`（只发 dev 分支 + tag + Pre-release，不碰 main）；
- 自测：`test-dev-publish` + `test-update-apply-result` 覆盖版本排序、通道切换、main 不探测 dev。
