# 记忆卡总在回忆第一天（recent 被初始板块挤空）

日期：2026-11-02

## 1. 现象

记忆卡的提示词长期以早期“最初的日子”为主，最近发生的事反而很少出现。报告 §3.2 指出这是默认值叠加，不是模型偏好。

## 2. 根因

1. `initialProbabilityForOffset()` 前 10 天 0.9，早期 owner 记录大量 `isInitial=true`。
2. `sectionize()` 里 `recent` 只收“非 owner 且非 initial”的记录；owner 近期记录不是进 `initial` 就是进 `owner`，`recent` 经常为空。
3. 预算裁剪优先级 `initial 45 > owner 40 > recent 30`，紧张时先砍 recent。
4. `limits` 是 `initial:6 / recent:8`，进一步偏向早期。

## 3. 修法（最小风险）

- `sectionize()` 先分“最近 N 天、非置顶、非 firstMet”的记录到 `recent`，**不管 owner/isInitial**；
- 再用剩余记录分 `initial` / `owner`；
- 用 `used` 去重，同一记录不能同时出现在 recent 和 initial；
- `recent` 上限 8→12；
- `initial` 上限仍 6（不一次扩到 24，避免提示词突然变大）；
- priority：`initial 45→26`、`owner 40→28`，`recent` 保持 30。

方向：预算紧张时先淡出早期“最初”，保住“最近”。

## 4. 生效

- 重启 DSH 插件；
- 旧卡下一次渲染自动按新分区规则重算；
- `firstMet` / pinned / anchors 仍优先保护。

## 5. 验证

```text
node scripts/test-memory-card.mjs
npm run test:audit
cd plugins/surfcore && npm test
```

新增测试覆盖：

- owner 的近期记录进入 `最近记得的`；
- 早期 `initial` 记录仍在 `最初的日子`；
- 同一记录不会同时出现在两个板块。

## 6. 风险

- 近期 owner 记录从 `owner/initial` 移到 `recent`，是行为变化；用户可能更常看到最近的事。
- `initial` 仍有 6 个名额；如果早期记录特别多，旧“最初”仍会占据一部分。
- 未改 `initialProbabilityForOffset`（仍 0.9），只是通过分区/预算降低影响。
- 没有统一提示词总预算；recent 12 条仍可能挤其他段，需观察实际字数。
- 旧卡 `isInitial` 是稳定散列，重算不会随机跳变。
- 没有真实聊天 live 验收；用单测与渲染测试。
