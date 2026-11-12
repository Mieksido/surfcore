/**
 * 语音包导入：把"目录里的一堆音频"整理成语音库条目
 * ============================================================================
 * 位置：内核·语音。**"哪些文件算语音、重名怎么办、最多收多少"是语音库的规矩**；
 * 真正读目录/拿文件大小是工具/壳的事（这里只吃文件名列表，不碰 fs）。
 *
 * 不猜时长：时长要 ffprobe/解码器；拿不到就留 null（normalizeVoice 允许），
 * 由发送闸门按字数/频率控制，不假装知道。
 */

/** 能当语音条的文件扩展名（与旧 voice-core 的口径一致，去掉了视频/文本） */
export const VOICE_AUDIO_EXTS = Object.freeze(['.wav', '.mp3', '.m4a', '.ogg', '.flac']);

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/** 这个文件名能不能当语音条（只看扩展名，不看内容） */
export function isVoiceAudioFile(name) {
  const n = String(name ?? '').toLowerCase();
  return VOICE_AUDIO_EXTS.some((ext) => n.endsWith(ext));
}

/** 文件名 → 语音库条目（id/name 用去扩展名的文件名；情绪/标签由导入参数给） */
export function voiceEntryFromFile(file, { emotion = '', tags = [], note = '' } = {}) {
  const raw = String(file ?? '').split(/[\\/]/).pop() ?? '';
  if (!isVoiceAudioFile(raw)) return null;
  const id = clean(raw.replace(/\.[^.]+$/, ''), 64);
  if (!id) return null;
  return {
    id,
    name: clean(id, 40),
    emotion: clean(emotion, 8),
    tags: (Array.isArray(tags) ? tags : []).map((t) => clean(t, 16)).filter(Boolean).slice(0, 6),
    note: clean(note, 80),
    durationMs: null,
  };
}

/**
 * 计划一次导入：不碰盘，只做去重/过滤/上限。
 * @param {object} input { files, existingIds, defaults, maxEntries }
 * @returns {{entries:object[], skipped:object[]}}
 */
export function planVoiceImport({
  files = [],
  existingIds = [],
  defaults = {},
  maxEntries = 200,
} = {}) {
  const seen = new Set((Array.isArray(existingIds) ? existingIds : []).map(String));
  const cap = Math.max(1, Number(maxEntries) || 200);
  const entries = [];
  const skipped = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!isVoiceAudioFile(file)) { skipped.push({ file: String(file), reason: 'unsupported' }); continue; }
    if (seen.size >= cap) { skipped.push({ file: String(file), reason: 'library-full' }); continue; }
    const entry = voiceEntryFromFile(file, defaults);
    if (!entry) { skipped.push({ file: String(file), reason: 'bad-name' }); continue; }
    if (seen.has(entry.id)) { skipped.push({ file: String(file), reason: 'duplicate' }); continue; }
    seen.add(entry.id);
    entries.push(entry);
  }
  return { entries, skipped };
}
