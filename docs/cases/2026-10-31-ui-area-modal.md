# 设置页区域按钮化 / 群管理进高级

- **日期**：2026-10-31
- **用户反馈**：UI 太繁杂；高级设置里每个区域应收成一个按钮，点开新窗口编辑；群管理不要放 QQ 页顶部，合并进高级设置。
- **范围**：QQ/B站“高级设置”字段组、群管理、鱼群保护、对话收尾。QQ/B站顶部卡片保持不变；其他页暂未全量改造。

## 1. 链路

```text
QQTab / BiliTab
  → AdvancedSettings
    → AreaButton（标题 + 摘要 + 箭头）
      → SettingsModal
        → Field / FieldGroups
        → 保存 → 父级 save()（/config）
```

群管理：

```text
QQ → 高级设置 → 群管理
  → 弹窗内 GroupPolicyPanel
  → 保存群分层（/group-policy）
```

## 2. 机制

- 新增 `AreaButton`、`SettingsModal`、`AreaModalCard`；
- `FieldGroups` 不再直接铺开字段，改为每个 group 一个按钮 + 弹窗；
- 弹窗内字段仍写父级 `cfg`，点「保存」调用父级 `save()`，写 `/config`；
- 群管理移到 `AdvancedSettings`，不再位于 QQ 页顶部；
- 鱼群保护、对话收尾也收成按钮 + 弹窗；
- QQ/B站顶部卡片不变，避免把关键状态藏起来。

## 3. 爆炸半径

- 只改客户端 `plugins/surfcore/lib/client.js`；
- 不改后端协议；弹窗保存仍走原 `/config` / `/group-policy`；
- 群管理弹窗内部保留自己的「保存群分层」按钮；弹窗没有重复的保存按钮。

## 4. 生效

- 纯客户端改动：重启 DSH 后生效；
- 若只刷新页面，旧 bundle 仍在缓存里。

## 5. 验证

```bash
cd plugins/surfcore
node scripts/test-client-contract.mjs
node scripts/test-ui-contrast.mjs
npm test
cd ../.. && npm run test:audit
```

手工：

1. QQ → 高级设置：出现「群管理」「鱼群保护」「对话收尾」和参数组按钮；
2. 点任意按钮：弹窗出现，字段可编辑，底部有保存（群管理用内部保存）；
3. 保存后关闭弹窗，配置写入；
4. QQ/B站顶部卡片保持不变。

## 6. 回滚与残余

- 回滚：恢复 `FieldGroups` 直接渲染、移除 `AreaButton`/`SettingsModal`；
- 残余：早安问候、定时分享仍为普通卡片；其他 tab 未全量按钮化。

## 7. 按功能分类

高级设置里的按钮不再平铺，按功能分组：

- QQ：接入与身份 / 人格与提示 / 群与安全 / 唤醒与收尾 / 发送与上下文 / 群聊与学习 / 工具与媒体 / 其他；
- B站：身份与权限 / 内容与口味 / 作息与分享 / 额度与工具 / 其他；
- 群管理、鱼群保护、对话收尾、工具面作为独立入口保留在高级设置内。

## 9. 群覆盖保存失败根因（补）

- 桥接 group-policy POST 对 readBody 已解析对象又 JSON.parse，返回 500。
- 前端选择即保存和保存按钮都因此失败，state/group-policy.json 一直没生成。
- 修法：POST body 同时兼容字符串与对象。
- 必须重启 QQ 桥接；旧进程仍跑旧解析。
