# 2026-11-01 · 一键安装弹窗深底深字（主题/对比度）

## 现象

浅色主题下点「一键安装」，弹窗是深色底，标题/说明/“取消”按钮都是深色字，几乎看不清；
深色主题正常。用户要求：**深色/浅色、有无 hover、按钮/文字/背景，任何组合都不能低对比**。

## 根因（内容/样式层，不是架构）

1. 安装弹窗用内联样式 `background: var(--qbw-bg2, #1b1d21)`，而 `--qbw-bg2` **从未定义** → 永远落深色；
2. 弹窗没有设置文字颜色，继承页面正文（浅色主题是深色）→ **1.07:1**；
3. `.qbw-hint` 用 `var(--dsw-alias-label-tertiary)`，但 DSH **没有这个 token**（只有 primary/secondary）→
   规则失效、颜色继承父级；
4. `.qbw-modal` 硬编码深色底 + 强制浅色字；浅色主题里的 `qbw-btn2`（取消/稍后）文字用 `label-primary`（深色）→ **1.34:1**；
5. `qbw-btn2/qbw-btn3` 没有 hover/focus 样式；禁用只降 opacity；
6. 全文件 76 个硬编码色、16 处内联颜色：警告橙 `#e6a23c` 在白底 **2.19:1**。

## 修法（P0+P1+P2，全部在样式/内容层）

- **P0**：新增 `--qbw-*` 语义层（surface/surface-2/text/muted/line/brand/on-brand/ok/warn/err），
  全部映射到 DSH 的 light/dark token；安装弹窗与 `.qbw-modal` 改为跟随主题；
  `label-tertiary` 全部换成真实 `label-secondary`；`on-brand` 用 `bg-base`（浅色主题浅字压深品牌，深色主题深字压浅品牌）。
- **P1**：76 个硬编码色 token 化；状态色按 `color-mix(状态色, 正文色)` 生成可读文字色；
  内联浅色卡片/分段控件/进度条全部走 token；补 `:hover`（次要按钮背景）、`:focus-visible`（品牌色 outline）、
  统一 `:disabled`；`select option` 跟随主题。唯一保留的固定白是二维码（扫描要求）。
- **P2**：新增 `scripts/test-theme-tokens.mjs`：
  - 只允许 DSH 真实存在的 token；`--qbw-*` 必须先定义；
  - 弹窗必须用 surface/text；禁止 `--qbw-bg2` / `label-tertiary`；
  - 必须有 hover/focus/disabled 规则；
  - 对 fallback 颜色算 WCAG（正文/浅底 15.80、次要文字 5.98、主按钮 4.55、正文/浅灰 14.34）。
  注册进 `test:audit`。

## 验证

```
node scripts/test-theme-tokens.mjs  → 全部通过
test-client-contract                → 通过
plugins/surfcore npm test           → 0 失败
npm run test:audit                  → 110/110
```

## 未验证 / 残余

- 没有在真实浏览器里逐屏截图（深/浅两种主题）；建议安装后人工过一遍主要页面；
- 装饰性渐变（头部/管理员卡）仍有少量品牌色 rgba，属于背景装饰，不承载文字；
- 其他插件/DSH 自身的弹窗不在本仓库范围。

## 教训

**“看起来是深色弹窗”往往是变量没定义 + 没设前景色**。只要有 light/dark 主题，
组件就必须成对声明“表面色 + 前景色”；状态色不能直接当文字色用，要和正文色混出可读性。
另外，引用 token 前要先确认它真实存在（DSH Theme 提供 14 个，没有 tertiary）。
