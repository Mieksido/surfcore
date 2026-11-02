# 人格语气层被核心覆盖（persona.tone.md 不生效）

日期：2026-11-02

## 1. 现象

按分层约定写了 `persona.md`、`persona.tone.md`、`persona.daily.md`、`persona.scenes/*`，但注入提示词里：

```text
【人格核心】persona.md
【人格语气】persona.md（错误）
```

核心出现两次，tone 文件完全没生效；不报错，只静默变长。

## 2. 根因

`src/character-persona.js` 的 `readPersonaLayerText()` 只有：

```js
kind === 'daily' ? layers.daily
: kind === 'scene' ? layers.scenes?.[scene]
: layers.core;              // tone 落到这里
```

`tone` 没有分支，回落到 core。  
QQ / B站 / 桌宠都调用 `readPersonaLayerText('tone')`，所以三个平台同时中招。

## 3. 修法

- 增加 `kind === 'tone' ? layers.tone` 分支；
- 未知 kind 不再静默回落：打印 warning 后回退 core；
- 新增真实文件读取测试：
  - 临时 DSH_HOME + 临时角色；
  - core/tone/daily/scene 各放独特标记；
  - 断言 `readPersonaLayerText('tone')` 读到 TONE_MARK，不是 CORE_MARK；
  - 未知层才允许回落 core。

## 4. 生效/风险

- 重启 DSH 插件 / 桥接；
- 没有 tone 文件的旧角色行为不变（tone 空 → composer 回落核心）；
- 有 tone 文件的角色提示词会明显变短，语气层真正生效；
- 角色说话风格可能看起来“变了”，这是修复目的；
- tone 文件读取异常仍 `catch` 返回空串，没有单独报错；
- 未知层 warning 只走 console，不弹用户。

## 5. 验证

```text
node scripts/test-persona-layer-read.mjs
node scripts/test-persona-layers.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
