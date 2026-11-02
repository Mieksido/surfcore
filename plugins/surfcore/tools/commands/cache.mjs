// 手动查看/清理 B站视频缓存（watch-video / debrief / subtitles 产出的 shots）。
// 日常命令会自动清理；这个入口给“现在就想知道占了多少 / 立刻清一次”用。
import { formatShotsStats, pruneShots } from '../lib/shots-cache.mjs'

const stats = pruneShots()
console.log(formatShotsStats(stats))
if (stats.errors.length) {
  console.error(`有 ${stats.errors.length} 个文件清理失败；第一个：${stats.errors[0].file}（${stats.errors[0].error}）`)
  process.exit(1)
}
