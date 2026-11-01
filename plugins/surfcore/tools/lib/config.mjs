// 统一配置层 —— 一个文件承载所有"属于使用者"的东西。
//
// 为什么要有它（2026-10-14 外部评审指出的最大架构缺口）：
//   在此之前，"个人化的东西"散在四处、形态还不一样 ——
//     ① `~/.dsh/surfcore/bili/quota.json`（额度/白名单，独立文件）
//     ② `~/.dsh/surfcore/bili/whale-night.config.json`（作息，独立文件）
//     ③ `whale-diary.md` 的叙事段落（偏好被 feed.mjs 解析 Markdown 提取 ✗ 脆弱）
//     ④ 代码里硬编码（历史昵称 SELF_NAMES ✗）
//   使用者的体验是"我得读源码才知道要改哪" ✗ —— 这不是模板，是作者的自用件。
//   现在：**填一个 `bili.config.json` 就完成自定义** ✓，其余全是中性默认值。
//
// 查找顺序：$SURFCORE_BILI_CONFIG → ~/.dsh/surfcore/bili.config.json → 内置默认值（中性）
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_BILI_FISH_GUARD } from './fish-guard.mjs'
import { DEFAULT_LIMITS } from './limits.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export const configPath = process.env.SURFCORE_BILI_CONFIG || path.join(HOME, '.dsh', 'surfcore', 'bili.config.json')

/** 中性默认值：不含任何作者的个人信息，换个人也能跑。 */
export const DEFAULTS = {
  persona: {
    name: '<角色名>',
    ownerTitle: '你',      // 助手怎么称呼使用者
    selfClaim: '我',       // 助手怎么自称
    diaryTitle: '今日摘要', // diary show 的标题（想用自己的口吻就改这里）
  },
  preferences: {
    like: ['AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
    // 每个偏好关键词的权重（0~5；0 = 停用，1 = 默认）。键名就是关键词本身。
    weights: {},
  },
  notify: { type: 'none', url: '', template: 'text', cmd: '', timeoutMutes: [] },   // none | desktop | qq | webhook | command（见 commands/notify.mjs）
  // 沉默逛：只看不说。enabled=false 时禁止评论/回复/搭话/动态/分享/私信，但仍可看/评分/写日记。
  interact: { enabled: true, maxCommentAgeDays: 14 },
  aliases: [],                  // 历史昵称（兜底用；当前昵称仍从 nav 动态读）
  // 使用者本人（分享型评论要 @ 的人）：mid 用于白名单/查询，name 用于正文里的 @昵称
  // （acc/info 查询会风控，所以 name 缓存一份；改过就用 thread 的 `@到:` 验一下）
  owner: { mid: '', name: '' },
  quota: { shareDaily: 3 },
  // 四本账的硬闸门（2026-10-22 从代码搬到配置；设置页可改）。默认值与旧行为一致。
  //   普通评论 / 回找我的人 / 主动搭话 / 动态回复 / 各冷却。
  limits: { ...DEFAULT_LIMITS },
  // 四类动态（2026-10-22 可编辑）：总开关、两条之间的最小间隔、每类的时段/长度/开头。
  //   kinds 里只存"被改过的字段"；缺省值在 tools/lib/kinds.mjs 的 DEFAULT_KINDS。
  dynamics: { enabled: true, gapMin: 30, kinds: {} },
  // 2026-10-23 用户定：默认发自己的动态（视频卡片），不再默认评论区 @ 主人。
  share: { enabled: true, via: 'dynamic', minScore: 13, silentAfterDays: 3, decayPerDay: 1 },  // 分享型开关与评分阈值
  // 倾听（2026-10-18 补默认值，与设置页对齐）：评论区 + 直播间
  listen: { comment: true, commentIntervalSec: 300, scope: 'both', oncePerPerson: false, allDay: false, dm: false, live: false, liveRoom: '', liveScope: 'owner' },
  // 作息：windows[] = 每天允许醒来的时段（每个窗口 = 一次机会）；maxWakesPerDay 缺省 = 窗口数（硬上限 3）
  night: { windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0.3, maxVideos: 5, minGapMin: 20 },
  // 评论区鱼群保护：鱼太多不发新楼层；优先回鱼；给鱼点赞（设置页可改）。
  fishGuard: DEFAULT_BILI_FISH_GUARD,
  // B站 自己的 DSH 会话权限（2026-10-23）：
  //   %USERPROFILE% 在 workspace-write 下会因 WRITE_OWNER 起不了命令，
  //   定时醒来的 she 一条 bili.mjs 都跑不了。默认只给这一个会话完全访问；
  //   想收紧就改成 workspace-write，下一次 tick 生效。
  agent: { sandbox: 'danger-full-access' },
}

const merge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

let cache = null
let cacheKey = ''
/**
 * 读取合并后的配置（按文件 mtime/size 缓存）。
 *
 * ⚠️ 2026-10-22：以前是"进程内永久缓存"，长驻的插件宿主改了设置也读不到新值。
 *   现在每次调用先 stat 一下（很便宜）；文件不变就用缓存，变了就重读。
 *   这样调度器/提示词里的额度、四类动态、分享上限都能"改完下一轮生效"。
 */
export function config() {
  let key = 'none'
  try {
    const stat = fs.statSync(configPath)
    key = `${stat.mtimeMs}:${stat.size}`
  } catch { /* 没有用户配置 */ }
  if (cache && key === cacheKey) return cache
  let user = {}
  try { user = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { /* 没配置就用默认 */ }
  cache = merge(DEFAULTS, user)
  cache.__hasUserFile = Object.keys(user).length > 0
  cacheKey = key
  return cache
}
