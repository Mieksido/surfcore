/**
 * 表情语义：一句话是什么情绪
 * ============================================================================
 * 位置：内核表情模块的内部策略（纯函数 + 词表）。**不认识任何平台**。
 *
 * 搬自旧 sticker-semantics.js 的情绪表（18 类 + 邻近关系），但去掉了旧代码里的
 * "注意力编码/向量"那套实验（未训练，收益不明显）——只留**词表 + 邻近兜底**：
 *   · 说法不同、意思相近 → 靠词表覆盖（"绷不住""笑不活"都算搞笑）
 *   · 情绪相近 → 靠 neighbors 给部分分（委屈↔难过、嘲讽↔得意）
 *
 * 改法：只改这张表（加词、加邻近关系）。改完跑 semantics.test.mjs。
 */

/** 情绪表：label 既是给人看的，也是存库用的（与旧数据一致） */
export const EMOTIONS = Object.freeze([
  { label: '开心', words: ['开心', '高兴', '好耶', '太好了', '爽', '幸福', '哈哈哈', '嘿嘿', '乐死', '棒', '快乐', '美滋滋'], neighbors: ['卖萌', '赞同', '搞笑'] },
  { label: '搞笑', words: ['搞笑', '好笑', '绷不住', '笑不活', '乐子', '整活', '离谱', '笑死', '草', '233', '段子'], neighbors: ['嘲讽', '开心', '无语'] },
  { label: '得意', words: ['得意', '嚣张', '小样', '拿捏', '稳了', '哼哼', '骄傲', '炫耀', '看我', '轻轻松松'], neighbors: ['嘲讽', '开心'] },
  { label: '嘲讽', words: ['嘲讽', '嘲笑', '杂鱼', '就这', '菜鸡', '欠揍', '阴阳', '讽刺', '拉胯', '不行啊', '笑你'], neighbors: ['得意', '搞笑', '生气'] },
  { label: '傲娇', words: ['傲娇', '才不是', '才没有', '谁要', '口是心非', '别扭', '哼'], neighbors: ['嘲讽', '害羞'] },
  { label: '害羞', words: ['害羞', '脸红', '不好意思', '羞耻', '捂脸', '别看', '害羞了'], neighbors: ['卖萌', '傲娇'] },
  { label: '卖萌', words: ['可爱', '萌', '软乎乎', '贴贴', '抱抱', '亲亲', '撒娇', '嘤嘤', '乖', '摸摸'], neighbors: ['害羞', '开心', '安慰'] },
  { label: '委屈', words: ['委屈', '冤枉', '背锅', '不是我', '欺负', '可怜', '呜呜', '凭什么', '委屈巴巴', '想哭', '被骂', '挨骂', '别嘲笑', '再嘲笑', '不要嘲笑', '别笑我', '笑话我', '求求', '别骂了'], neighbors: ['难过', '安慰', '卖萌'] },
  { label: '难过', words: ['难过', '伤心', 'emo', '破防', '哭了', '失落', '难受', '崩溃', '心碎', '没意思', '沮丧'], neighbors: ['委屈', '安慰'] },
  { label: '生气', words: ['生气', '气死', '愤怒', '恼火', '火大', '想打人', '过分', '可恶', '烦死'], neighbors: ['嘲讽', '无语'] },
  { label: '无语', words: ['无语', '沉默', '问号', '服了', '醉了', '汗', '逆天', '说不出来', '呃'], neighbors: ['摆烂', '搞笑', '生气'] },
  { label: '摆烂', words: ['摆烂', '躺平', '累了', '累死', '不想动', '上班', '划水', '摸鱼', '加班', '打工'], neighbors: ['无语', '馋饿'] },
  { label: '安慰', words: ['安慰', '摸摸头', '别难过', '没事的', '心疼', '拍拍', '不哭', '有我在'], neighbors: ['卖萌', '委屈', '难过'] },
  { label: '赞同', words: ['赞同', '同意', '对对对', '确实', '就是啊', '就是这样', '同上', '附议', '加一', '支持', '我也是'], neighbors: ['开心', '卖萌'] },
  { label: '惊讶', words: ['惊讶', '震惊', '卧槽', '真的假的', '不会吧', '什么鬼', '惊了', '啊这', '居然'], neighbors: ['无语', '搞笑'] },
  { label: '告别', words: ['再见', '拜拜', '晚安', '走了', '下线', '睡了', '告辞', '溜了', '下次聊'], neighbors: ['开心', '卖萌'] },
  { label: '馋饿', words: ['饿', '馋', '想吃', '饭饭', '宵夜', '奶茶', '干饭', '外卖', '好吃'], neighbors: ['摆烂', '卖萌'] },
  { label: '害怕', words: ['害怕', '怕了', '恐怖', '吓人', '瑟瑟发抖', '不敢', '慌'], neighbors: ['惊讶', '委屈'] },
]);

/** 兜底：没有明显情绪 */
export const NEUTRAL = '平淡';

const BY_LABEL = new Map(EMOTIONS.map((e) => [e.label, e]));
export const EMOTION_LABELS = EMOTIONS.map((e) => e.label);

/** 允许把英文/中文混着写，统一成中文标签（存库口径不变） */
export function normalizeEmotion(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (BY_LABEL.has(s)) return s;
  const hit = EMOTIONS.find((e) => e.label === s || e.label.toLowerCase() === s.toLowerCase());
  return hit ? hit.label : '';
}

/** 一句话命中哪些情绪（按命中词数排） */
export function detectEmotions(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const hits = [];
  for (const e of EMOTIONS) {
    let n = 0;
    for (const w of e.words) if (w && s.includes(w)) n += 1;
    if (n > 0) hits.push({ label: e.label, hits: n });
  }
  return hits.sort((a, b) => b.hits - a.hits);
}

/** 最可能的情绪；判断不出来就返回「平淡」 */
export function emotionOf(text) {
  const hits = detectEmotions(text);
  return hits.length ? hits[0].label : NEUTRAL;
}

/** 相近情绪（对称，两边都认） */
export function neighborsOf(label) {
  const key = normalizeEmotion(label);
  if (!key) return [];
  const direct = BY_LABEL.get(key)?.neighbors ?? [];
  const back = EMOTIONS.filter((e) => (e.neighbors ?? []).includes(key)).map((e) => e.label);
  return [...new Set([...direct, ...back])];
}

/**
 * 给一张表情对"目标情绪"打匹配分：命中 1.0，邻近 0.45，其它 0。
 */
export function emotionScore(targetLabel, stickerEmotion) {
  const t = normalizeEmotion(targetLabel);
  const s = normalizeEmotion(stickerEmotion);
  if (!t || !s) return 0;
  if (t === s) return 1;
  return neighborsOf(t).includes(s) ? 0.45 : 0;
}
