# 2026-11-03 · 取消「跟随 DSH 默认模型」报 404

## 现象

0.8.7 设置 → 模型与思考强度 → 取消勾选「跟随 DSH 默认模型」：

```
POST /dsh-surfcore/api/dsh/follow-default
→ 404 { ok:false, error:"未知接口：/dsh-surfcore/api/dsh/follow-default" }
```

勾选框能显示当前状态（读 `GET /dsh/model` 正常），但一改就 404，用户以为“关不掉”。

## 根因

- 桥接 `src/bridge.js` **已完整实现** `POST /api/dsh/follow-default`（原子写、热更新、缓存失效、结构化错误）；
- 前端 `client.js` 也调了 `/dsh/follow-default`；
- 宿主 `index.js` 只代理了 `/dsh/model`、`/dsh/effort`、`/dsh/repair`，**漏了 follow-default**；
- 请求在宿主层命中兜底 404，桥接实现永远收不到。

读写不对称：GET 走已代理的 `/dsh/model`，所以“能显示、改不动”。

## 修法

- 新增 `proxyDshFollowDefault()`：只允许 POST；请求体非法 → 400 `DSH_FOLLOW_BODY`；
  桥接不可用/旧版 → 502，带 `DSH_FOLLOW_BRIDGE` + hint；
- 路由表注册 `${API_PREFIX}/dsh/follow-default`；
- 新增 `scripts/test-dsh-follow-route.mjs`：静态钉住“前端路径 ⊆ 宿主路由”，并检查三个失败码；
- 注册进 `test:audit`。

## 验证

```
node scripts/test-dsh-follow-route.mjs   ✅
npm run test:audit                       143/143
node scripts/release-manifest.mjs --verify-ref HEAD   679 / 0
```

手动验证（修完后）：

1. 设置页取消勾选 → 出现成功 toast，不再红字；
2. `config.json` 的 `dsh.followDefaultModel` 变为 `false`；
3. 桥接日志出现“不再跟随 DSH 默认模型”；
4. 桥接没起时应返回 `DSH_FOLLOW_BRIDGE` + hint，而不是 404。

## 残余

- 这是一类问题（前端路径集合 ⊄ 宿主路由集合），本次只加了针对这条路由的契约；
- 更彻底的做法是把宿主 if 链改成显式路由表，测试直接读表，后续新增接口不再靠人记得两处都改。
