# 2026-10-28 · 语音包「装了却显示未安装」

## 现象

- 用户把本地语音包装在 `文档\surfcore\state\voice-packs\voice-local`（`config.toml`、`.venv`、`.venv-gsv` 都在）；
- 语音页仍显示「安装（1.9GB）」，判定未安装；
- 配置里的「安装目录」是另一个路径（`C:\Users\<user>\surfcore\state\voice-packs`）。

## 根因

`src/voice-packs.js` 的 `packDir()` 只看**一个**目录：`cfg.voicePacks.dir`（或仓库根）。
端口没起来时，`statusOne()` 也拿不到「外部安装」信号 → `installed=false`。

为什么包会跑到另一个目录：早期版本默认目录用 `process.cwd()`（0.6.0 才统一到仓库根），
用户在不同 cwd 下装过，或手工搬过目录，配置与实际位置就对不上。

## 修法（v0.6.10）

1. `packDir()` 增加候选目录：配置目录 → 仓库根 → `cwd` → `文档\surfcore\state\voice-packs`
   → `~\surfcore\state\voice-packs`，命中 `config.toml` 即返回；
2. `statusOne()` 区分 `external`（目录在别处 / 只有端口在跑），把真实路径回给 UI；
3. 语音卡显示「已在别处安装：<路径>」+「把安装目录设为这里」（写 `voicePacks.dir`）；
4. 启动/停止/卸载都用找到的那份，避免让用户重下 1.9GB。

## 验证

- `npm run test:audit` 77/77；
- 手工：把包放到候选目录之一、配置指向别处 → 页面应显示「已安装 · 未运行」，点启动走的是找到的目录（待真实用户验证）。

## 遗留

- 目录名不是 `voice-local` / `voice-cloud` 时仍识别不到（可按 basename 模糊匹配，但可能误认）；
- 建议补测试：给定多个候选目录，`packDir()` 应优先返回配置目录，其次仓库根。
