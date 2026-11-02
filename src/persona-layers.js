/**
 * 人格卡分层（Persona Layers v1）。
 *
 * 文件布局（角色包内）：
 *   persona.md                    人格核心（旧角色没有分层时只有它）
 *   persona.daily.md              人格日常（可选）
 *   persona.scenes/qq-group.md    QQ 群聊场景
 *   persona.scenes/qq-private.md  QQ 私聊场景
 *   persona.scenes/bili.md        B站场景
 *   persona.scenes/pet.md         桌宠场景
 *
 * 规则：
 *   · 核心放最前，稳定、可缓存；
 *   · 场景按平台/群聊私聊选择；
 *   · 日常放最后，变化最频繁；
 *   · 超预算先砍日常，再砍场景，核心不主动丢（核心本身超限才截断并标记）。
 *
 * 这是纯逻辑，不读文件、不碰 DSH；读写路径在 character-persona.js。
 */
import { selectRoleText } from './role-card.js';

export const PERSONA_SCENES = Object.freeze(['qq-group', 'qq-private', 'bili', 'pet']);

export const PERSONA_SCENE_LABELS = Object.freeze({
  'qq-group': 'QQ 群聊',
  'qq-private': 'QQ 私聊',
  bili: 'B站',
  pet: '桌宠',
});

/** 根据会话 key / 平台选择场景卡。 */
export function personaSceneFromKey(key = '', platform = '') {
  const k = String(key ?? '');
  if (k.startsWith('group:')) return 'qq-group';
  if (k.startsWith('private:')) return 'qq-private';
  if (platform === 'bili' || platform === 'pet') return platform;
  return '';
}

function section(id, label, text) {
  return { id, label, text: String(text ?? '').trim() };
}

/**
 * 组合人格卡。
 * @param {object} opts
 * @param {string} opts.core 核心
 * @param {string} [opts.scene] 场景
 * @param {string} [opts.daily] 日常
 * @param {string} [opts.tone] 语气
 * @param {string} [opts.identity] 身份底座（无论 tone/full 都带：我是谁、主人是谁）
 * @param {'full'|'tone'} [opts.personaMode] full=核心+语气+场景+日常；tone=语气+场景+日常
 * @param {'v1'|'v2'} [opts.mode] 仿真模式；每层分别过滤 〔一代〕/〔二代〕小节
 * @param {number} [opts.maxChars] 总预算；<=0 不限
 * @param {string} [opts.sceneId] 场景 ID（用于标题）
 */
export function composePersonaLayers({
  core = '', scene = '', daily = '', tone = '', identity = '', personaMode = 'full', mode = 'v2', maxChars = 6000, sceneId = '',
} = {}) {
  const budget = Math.max(0, Math.round(Number(maxChars) || 0));
  const coreText = selectRoleText(core, mode);
  const toneText = selectRoleText(tone, mode);
  const sceneText = selectRoleText(scene, mode);
  const dailyText = selectRoleText(daily, mode);
  // tone 模式不加载核心；只有旧角色既没有语气也没有场景/日常时，才回退核心，避免“没卡”。
  const identityText = String(identity ?? '').trim();
  const identitySection = identityText ? [section('identity', '身份底座', identityText)] : [];
  // tone 模式只在「确实写了语气层」时才省掉核心：
  //   · 未拆分（只有 persona.md）→ 必须注入核心，否则只剩身份底座、人设正文全丢；
  //   · 只拆了日常/场景、没写语气 → 也注入核心（语气层才是核心的替代品）；
  //   · 写了语气 → 按设计只带语气+场景+日常，省 token。
  const useToneOnly = personaMode === 'tone' && Boolean(toneText);
  // tone 与 core 内容完全相同时（旧角色复制了一份、或误把 core 当 tone），full 模式不再重复拼两段。
  const duplicateTone = personaMode !== 'tone' && Boolean(toneText) && toneText === coreText;
  const coreSection = useToneOnly ? [] : [section('core', '人格核心', coreText)];
  const selected = [
    ...identitySection,
    ...coreSection,
    section('tone', '人格语气', duplicateTone ? '' : toneText),
    section('scene', `场景人格${PERSONA_SCENE_LABELS[sceneId] ? `｜${PERSONA_SCENE_LABELS[sceneId]}` : ''}`, sceneText),
    section('daily', '人格日常', dailyText),
  ].filter((x) => x.text);

  const counts = { identity: 0, core: 0, tone: 0, scene: 0, daily: 0 };
  const omitted = [];
  if (!selected.length && personaMode === 'tone' && coreText) {
    const fallback = coreText;
    counts.core = fallback.length;
    return { text: fallback, chars: fallback.length, layers: counts, omitted, truncated: false, sceneId: sceneId || '' };
  }
  if (!selected.length) return { text: '', chars: 0, layers: counts, omitted, truncated: false, sceneId: sceneId || '' };

  // 只有核心时保持旧行为：不额外加标题，避免旧角色卡注入内容发生变化。
  if (selected.length === 1 && selected[0].id === 'core' && budget <= 0) {
    counts.core = selected[0].text.length;
    return { text: selected[0].text, chars: counts.core, layers: counts, omitted, truncated: false, sceneId: sceneId || '' };
  }

  let remaining = budget > 0 ? budget : Number.POSITIVE_INFINITY;
  let truncated = false;
  const parts = [];
  for (const item of selected) {
    // 只有核心时不加标题（旧行为）；有多层时明确告诉模型这是哪一层。
    const header = selected.length > 1 ? `【${item.label}】\n` : '';
    let text = item.text;
    if (Number.isFinite(remaining)) {
      const allowed = remaining - header.length;
      if (allowed <= 0) {
        omitted.push(item.id);
        counts[item.id] = 0;
        continue;
      }
      if (text.length > allowed) {
        text = text.slice(0, allowed).trimEnd();
        truncated = true;
      }
    }
    if (!text) { omitted.push(item.id); continue; }
    const block = `${header}${text}`;
    parts.push(block);
    counts[item.id] = block.length;
    if (Number.isFinite(remaining)) remaining -= block.length;
  }

  const text = parts.join('\n\n').trim();
  return { text, chars: text.length, layers: counts, omitted, truncated, sceneId: sceneId || '' };
}
