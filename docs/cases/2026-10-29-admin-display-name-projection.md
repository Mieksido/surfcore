# 设置了称呼「弥叭」，QQ 里仍叫「管理员」

- **日期**：2026-10-29
- **版本**：v0.7.2 用户反馈
- **现象**：设置页管理员卡片把称呼设为「弥叭」，QQ 消息里模型仍写「弥叭管理员」；
  提示词实际是 `称呼「管理员」`，消息头群名片是 `弥叭(3287064288)`。
- **影响**：QQ 每条消息/唤醒的称呼错误；B站 侧同样缺 `biliName`；桌宠正常（读 unified）。

## 原因（三段断链）

1. **投影缺字段**：`projectAdminSave` 的 `outQq` 只写 `ownerQQ`，没有写
   `displayName / biliName / gentle`。设置页保存后，unified 有 `admin.displayName=弥叭`，
   但 `config.json` 的 `admin` 是 `null`；桥接是独立进程，只读 `config.json`。
2. **桥接兜底把身份当称呼**：`adminDisplayName` 在没有名字时返回 `'管理员'`，
   提示词于是生成 `称呼「管理员」`；模型把群名片「弥叭」和「管理员」拼成「弥叭管理员」。
3. **启动时读配置**：桥接只在启动时读 `config.json`；修完投影后必须重启桥接。

## 修法

- `projectAdminSave` 的 `outQq` 带上完整的 `admin` 投影（qq/biliMid/biliName/displayName/gentle）；
  只改 unified 时也补最小投影。
- `adminDisplayName` 没名字时返回空串，不再把 `'管理员'` 当名字。
- `adminPromptBlock` 明确写：
  - 有称呼：`称呼「<名字>」；「管理员」只是身份/权限标记，不要当名字或拼进称呼`；
  - 无称呼：`直接称呼「你」；「管理员」只是身份标记，不要当名字`。
- 插件启动时 `ensureAdminProjection()`：unified 有 admin、QQ config 缺/不一致时自动补投影；
  桥接在跑则 1.5 秒后重启，让它重新读配置。写入前有 `saveQqConfig` 备份。
- 单测补：`projectAdminSave.qq.admin.displayName`、桥接侧 `adminFromQqConfig` 读 displayName、
  无称呼时提示词不得出现 `称呼「管理员」`。

## 验证

```bash
node scripts/test-admin-identity.mjs
node scripts/test-admin-prompt-wiring.mjs
npm run test:audit
```

实测（当前本机 config.json 已有 admin）：`adminDisplayName` = 弥叭，
compact 提示词包含 `称呼「弥叭」`、不包含 `称呼「管理员」`。

## 残余

- 已发布的 v0.7.2 需要新版本；更新后插件启动会自动补投影并重启桥接。
- 如果用户手工改过 `config.json` 且 unified 没 admin，启动迁移会保留 QQ 现有 admin；
  unified 明确清空时以 unified 为准。
- 提示词里的 `【管理员】/【管理员·温柔】` 仍是身份标记，不是称呼；已明确告诉模型。
