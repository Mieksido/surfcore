# QQ 高级设置经常保存失败（CONFIG_STALE + warning 当错误）

日期：2026-11-02

## 1. 现象

QQ 高级设置改一项后点「保存」或「保存并重启 QQ 桥接」：

- 经常出现黄色/红色提示；
- 用户以为没保存，再点一次；
- 第二次直接 `CONFIG_STALE`「配置已被别处修改」；
- 完全冷启动只能恢复一次，之后又循环。

## 2. 根因

两个问题叠加：

### 2.1 保存后没有刷新 `baseStamp`

前端只在 `loadConfig()` 时设置 `configStamps`；保存成功后：

```js
r = await api('/config', { body: { ..., baseStamp: configStamps } });
```

服务端写入三份配置文件后返回 200，但**没有返回新的 stamps**；前端也没有 `setConfigStamps(r.stamps)`。

所以第二次保存仍带加载页面时的旧戳，服务端发现文件已经变了：

```text
第一次保存 → 文件 mtime/size 改变
第二次保存 → 旧 baseStamp != 当前 → 409 CONFIG_STALE
```

冷启动只是重置一次 stamps，代码不改就会再次发生。

### 2.2 例行提示被当成错误

后端每次保存 QQ/B站配置都返回：

```text
QQ 配置已保存；桥接只在启动时读 config.json，需要「重启桥接」才会生效。
B站配置已保存；生物钟每轮重读配置，下一轮即生效。
```

这其实是 `notes`，但前端：

```js
if (r.warnings?.length) setErr(r.warnings.join(" "));
```

把正常提示放进错误区，用户误以为失败，再点一次，正好撞上 2.1 的 409。

## 3. 修法

- `POST /config` 成功后返回新的 `stamps`（在所有写操作/桥接重启之后计算）；
- 前端保存成功后 `setConfigStamps(r.stamps)`；
- 409 仍保留“重新读取”提示，不自动套用 stamps（避免覆盖真正并发修改）；
- 例行的“已保存，需要重启”移到 `notes`，用灰色 hint 显示；
- 真正的警告放黄色 `warnings` 区，不再进 `setErr`；
- 新增连续保存/戳同步回归测试。

## 4. 生效/风险

- 重启 DSH / 重载插件后生效；
- stamps 必须在所有副作用之后计算，否则还会 stale；
- 不删除 409 保护：如果桥接/控制台在保存前确实改了配置，仍会拒绝覆盖；
- 保存后不回读整份配置，避免覆盖用户保存期间的新编辑；
- `notes` 为新增字段，旧客户端忽略即可；
- 没有真实 UI 双击自动化测试，用源码/戳单测覆盖。

## 5. 验证

```text
node scripts/test-config-save-stamps.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
