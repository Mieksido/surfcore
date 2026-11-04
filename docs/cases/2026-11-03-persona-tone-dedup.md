# 人格语气层重复/未进目的提示词

日期：2026-11-03

对应：用户错误报告（`/api/socialV2/prompt` 的 `role.hint` 里【人格语气】=【人格核心】）

## 现象

- `persona.tone.md` 有内容，但提示词里的【人格语气】是 `persona.md` 的复制；
- `persona.tone.md` 完全没出现；
- 关掉括号动作/删符号都没用，因为语气层根本没进提示词。

## 版本差异

`v0.8.6` 如果是 `a8ebcba` 之前的构建，`readPersonaLayerText()` 没有 `tone` 分支：

```js
kind === 'daily' ? layers.daily
: kind === 'scene' ? layers.scenes?.[scene]
: layers.core;   // tone 落到 core
```

这个已在 `a8ebcba` 修复。

本批处理的是当前 dev 的残留：

1. `tone` 没有文件时仍 `layers.tone || layers.core`，full 模式会重复核心；
2. `composePersonaLayers` 在 `tone === core` 时仍拼两段；
3. 目的/主动搭话 `purposePersonaText()` 只读 `persona.md`，不读 tone。

## 修法

### 1. `readPersonaLayerText('tone')` 不再回退 core

```js
kind === 'tone' ? layers.tone : ...
```

没有 tone 文件就返回空，由 composer 决定“只保留 core”。

### 2. `composePersonaLayers` 去重

```js
const coreText = selectRoleText(core, mode);
const duplicateTone = personaMode !== 'tone' && toneText && toneText === coreText;
section('tone', '人格语气', duplicateTone ? '' : toneText)
```

- full 模式：tone 与 core 相同 → 不再生成【人格语气】；
- tone 模式：core 本来就不加载，保留唯一的 tone 正文；
- tone 为空：只保留 core。

### 3. 目的/主动搭话接入语气层

`purposePersonaText()`：

```js
const coreText = selectRoleText(core, 'v2');
const toneText = selectRoleText(readPersonaLayerText('tone'), 'v2');
return [...new Set([coreText, toneText].filter(Boolean))].join('\n\n');
```

## 没有做

- 没有自动给旧角色生成 `persona.tone.md`；
- 没有改角色卡导入/保存流程；
- 没有把 tone 接进所有可能的自定义提示词，只接了 QQ role.hint 与 purpose；
- 没有真实 DSH 端到端看 `/api/socialV2/prompt` 的完整输出（需要运行中的桥接 + 角色包）。

## 风险

- `tone` 与 `core` 相同会被去重，模型少一段重复文本，行为可能变化；
- 旧角色没有 tone 时 full 模式不再重复核心，提示词变短；
- purpose 现在带语气层，主动搭话风格可能变化；
- tone 读取失败仍是空串，没有单独报错；
- 如果用户把“语气”写成和核心完全一样，去重后不会出现【人格语气】标题。

## 验证

```text
node scripts/test-persona-layer-read.mjs
node scripts/test-persona-layers.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
