/**
 * 平台包：B站
 * ============================================================================
 * 声明式壳 + 可离线排程。B站 的特点是**异步**（评论/动态不是实时对话），
 * 所以能力轴与 QQ 完全不同 —— 这正是"六条轴"存在的意义：
 * 内核不用知道"这是 B站"，只需要知道"它是异步的"。
 *
 * 生物钟、额度、选片的规则在 logic.js；plan() 把三者合成一次"醒来"的计划。
 * 网络层（真评论/真动态）属于接入时，需要真登录态。
 */
import { createQuota, planNight, pickVideos } from './logic.js';
import { planShareSchedule } from './slots.js';
export const identity = {
  publisher: 'surfcore',
  name: 'bilibili',
  version: '0.1.0',
  source: 'bili',
  channel: 'bili:default',
};

export const capabilities = {
  timing: 'async',          // ← 与 QQ 最大的不同：按天算，不指望马上有回音
  shape: 'single',
  identityMode: 'known',
  direction: 'both',
  frequency: 'human',
  modality: 'multi',
  special: { recall: false, edit: true, readReceipt: false },  // B站 评论可编辑、不可撤回
};

export const settings = [
  {
    key: 'bili.quota.comments', label: '每日评论额度', description: '一天最多评论几条',
    defaultValue: 5, options: [0, 3, 5, 10], cost: '多了像机器人，容易被风控',
    group: 'basic',
  },
  {
    key: 'bili.clock.skipProbability', label: '跳过某次醒来的概率', description: '让人看不出来是定时的',
    defaultValue: 0.2, options: [0, 0.2, 0.5], cost: '越高越像人，但一天可能什么都没干',
    group: 'advanced',
  },
];

const ui = {
  menu: [{ id: 'bilibili', title: 'B站', order: 30 }],
  pages: [{ id: 'bilibili.settings', title: 'B站设置', kind: 'form', menu: 'bilibili' }],
};

let stopped = true;

/**
 * 计划一次"醒来"：生物钟 + 选片 + 额度，三件事一起给。
 * 这是这个包对外的真实能力（不需要网络即可计算），由调度方调用。
 *
 * 可选加一道**分享槽位**：传了 shareTimes 就按"一天固定几个点 + 同点只跑一次 +
 * 错过 10 分钟补跑"来闸门（旧 bili-share-scheduler.js 的规矩，已抽到 slots.js）。
 * 不传就是纯"生物钟"模式，保持旧测试与手动调用不变。
 */
export function plan({
  windows = [{ start: '20:00', end: '23:00', videosPerWake: 2 }],
  candidates = [], seenIds = [], prefs = [],
  countToday = 0, maxPerDay = 3, skipProbability = 0.2, now = Date.now(),
  shareTimes = null, slotState = null, catchUpMs,
} = {}) {
  let slot = null;
  if (Array.isArray(shareTimes) && shareTimes.length) {
    const schedule = planShareSchedule({ now, times: shareTimes, state: slotState ?? {}, catchUpMs });
    if (!schedule.due) {
      return {
        wake: false,
        reason: schedule.reason,
        hint: slotHint(schedule.reason, schedule.next),
        nextAt: new Date(schedule.next.at).toISOString(),
        slot: schedule.slot,
      };
    }
    slot = schedule.slot;
  }

  const quota = createQuota({ limits: { share: 1, comment: 3, dm: 3, danmaku: 20 }, now: () => now });
  const share = quota.canDo('share');
  if (!share.ok) return { wake: false, reason: 'no-quota', hint: share.hint };

  const night = planNight({ windows, maxPerDay, countToday, skipProbability, now: () => now });
  if (!night.wake) return { wake: false, reason: night.reason, hint: night.hint };

  const videos = pickVideos({ candidates, seenIds, prefs, limit: night.videosPerWake });
  if (!videos.length) return { wake: false, reason: 'nothing-to-watch', hint: '没有可选的片子：先扩充候选池' };

  return {
    wake: true, reason: 'in-window', window: night.window, videos,
    quota: { share },
    slot: slot ? { key: slot.key, label: slot.label, at: slot.at } : null,
  };
}

/** 槽位没到点时给人话（错误也要能行动） */
function slotHint(reason, next) {
  const nextLabel = new Date(next.at).toLocaleString('zh-CN', { hour12: false });
  if (reason === 'already-used') return `这个点已经分享过了：等下一个点 ${nextLabel}`;
  if (reason === 'missed-window') return `这个点已错过补跑窗口：等下一个点 ${nextLabel}`;
  if (reason === 'before-first-slot') return `今天第一个分享点还没到：等 ${nextLabel}`;
  return `还没到分享点：等 ${nextLabel}`;
}

export async function open(ctx) { stopped = false; ctx.log('info', 'bilibili 平台包已装载（角色/评论通道尚未接入；plan() 可离线排程）'); }
export async function send() {
  if (stopped) return { status: 'failed', error: { code: 'adapter.not-started', message: '平台包未启动' } };
  return { status: 'unsupported', error: { code: 'adapter.not-implemented', message: 'bilibili 通道尚未接入' } };
}
export async function health() { return { status: stopped ? 'down' : 'degraded' }; }
export async function close() { stopped = true; }

export default { identity, capabilities, ui, settings, open, send, health, close, plan };
