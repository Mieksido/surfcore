# B站视频缓存（shots）无限增长

日期：2026-11-02

## 1. 现象

`~/.dsh/shots` 下：

```text
video/   原片 mp4 + 九宫格 + 字幕条
covers/  封面 jpg
subs/    字幕 json/txt/plain
```

只增不减；报告实例 7 天 1.3 GB，平均每次 24 MB。

## 2. 根因

- `bili-watch.mjs` 默认 `outDir = ~/.dsh/shots/video`，原片刻意保留；
- 结束时只删 `.frames-*` 临时目录，不删 mp4/九宫格/字幕条；
- `debrief.mjs` / `subtitles.mjs` 写 `shots/covers`、`shots/subs`，同样没有保留期；
- 全仓库没有 shots 的 retention/上限/清理日志；
- 路径写死 `~/.dsh`，不读 `DSH_HOME`，也不支持 `shots.dir`。

## 3. 修法

- 新增 `tools/lib/shots-cache.mjs`：
  - 统一解析 `DSH_HOME` / `bili.config.json` 的 `shots.dir`；
  - `pruneShots()` 按 `shots.retentionDays`（默认 7）清理；
  - 可选 `shots.maxMB` 总大小上限，从最旧开始清；
  - 只删 `video/covers/subs` 的普通文件；`.frames-*` 只清超期目录；
  - 返回 `{files,bytes,removed,freed,errors}`；`formatShotsStats()` 输出一行摘要。
- `bili-watch`：
  - 默认抽完帧删原片；`--keep-mp4` 才保留；
  - `--keep-mp4` 从 `debrief --substrip` 显式传给 watch，字幕条完成后再删；
  - `.frames-*` 放进 `finally`，失败也清；
  - 默认目录结束跑 prune 并输出统计。
- `debrief`：
  - 封面/字幕目录改走 `shotsPath()`；
  - 有 `--substrip` 时保留 mp4，字幕条完成后删；
  - 结束 prune。
- `subtitles`：默认目录改走 `shotsPath('subs')`，结束 prune。
- 设置页新增「B站 视频缓存」：目录、保留天数、总大小上限。
- 新增缓存轮转测试。

## 4. 生效/风险

- 重启 DSH / 重新加载插件后生效；
- 直接 watch-video 默认不保留 mp4；要保留加 `--keep-mp4`；
- `debrief --substrip` 已处理“先保留、字幕条后删除”；
- 删除只针对 shots 下三类子目录，未知文件不动；
- 自定义 `outDir` / `subtitles --out` 不参与默认清理，避免误删；
- 7 天保留可能删用户想留的片段：重要视频请另存或调大 `shots.retentionDays`；
- 总大小上限可能清掉较新的文件（从最旧开始），默认 0 不启用；
- 没有按角色隔离 shots；多角色仍共用同一缓存，后续可再改。

## 5. 验证

```text
node scripts/test-shots-cache.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
