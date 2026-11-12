window.__ModuleLoader__.load({
  id: '@local/surfcore-ui',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;

    /* 来源映射（src/lib/source.js，构建时内联；UI 唯一平台字典） */
    /* __SOURCE_LIB__ */

    /* 语音控制面 API 层（src/lib/voice-control.js，构建时内联） */
    /* __VOICE_CONTROL_LIB__ */

    /* 全局右键返回：输入控件内不触发，交给浏览器原生右键菜单。
       统一收口在这里，以后新增 input/textarea/contenteditable 自动生效。 */
    const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden']);
    function isEditableContextTarget(target) {
      let node = target;
      if (node && node.nodeType !== 1 && node.parentElement) node = node.parentElement;
      if (!node || node.nodeType !== 1) return false;
      if (typeof node.closest !== 'function') return false;
      const input = node.closest('input');
      if (input) return !NON_TEXT_INPUT_TYPES.has(String(input.type || 'text').toLowerCase());
      if (node.closest('textarea, select, [role="textbox"]')) return true;
      const editable = node.closest('[contenteditable]');
      if (editable) return String(editable.getAttribute('contenteditable') || '').toLowerCase() !== 'false';
      return false;
    }

    /* ┢�┢� 构建时注入的真数据（壳只陈列，不推断�?┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    const ADAPTERS = __ADAPTERS__;
    const ADAPTER_META = __ADAPTER_META__;
    const KERNEL_DATA = __KERNEL_DATA__;
    const MEMORY = __MEMORY_DATA__;
    const IMPORTS = __IMPORTS__;
    const BG = __BG__;
    const BUILD = __BUILD__;

    /* ┢�┢� 内核区块（照内核目录念） ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    const BLOCKS = [
      { id: 'purpose', name: '目的', en: 'PURPOSE', note: '驱动 · 目标假设 · 观察账本 · 闭环', hue: 268 },
      { id: 'memory', name: '记忆', en: 'MEMORY', note: '写入流水线 · 双卡双线 · 联想 · 分节读', hue: 205 },
      { id: 'attention', name: '时机', en: 'ATTENTION', note: '唤醒分级 · 群分层 · 鱼群 · 合批 · 轮次守卫', hue: 172 },
      { id: 'expression', name: '表达', en: 'EXPRESSION', note: '提示词 · 预算 · 工具面 · 模型往返 · 降级', hue: 190 },
      { id: 'voice', name: '语音', en: 'VOICE', note: '闸门 · 路由 · 合成请求 · 引擎端口 · 语音库', hue: 300 },
      { id: 'vision', name: '识图', en: 'VISION', note: '媒体摘要 · 图片/语音的文字稿', hue: 330 },
      { id: 'lexicon', name: '黑话', en: 'LEXICON', note: '候选 · 确认 · 防注入 · 提取提示词', hue: 42 },
      { id: 'sticker', name: '表情', en: 'STICKER', note: '收藏 · 18 类情绪 · 邻近匹配', hue: 15 },
      { id: 'closure', name: '收尾', en: 'CLOSURE', note: '道别 · 安静 · 聊太久 → 结束点', hue: 240 },
      { id: 'settings', name: '设置', en: 'SETTINGS', note: '声明校验 · 阈值 · 导出导入', hue: 150 },
      { id: 'support', name: '支撑', en: 'SUPPORT', note: '审计 · 预算 · 身份 · 谁是谁 · 我是谁', hue: 220 },
    ];

    const GROUPS = [
      { id: 'consciousness', name: '意识', en: 'CONSCIOUSNESS', note: '目的', hue: 268, blocks: ['purpose'] },
      { id: 'memory', name: '记忆', en: 'MEMORY', note: '记忆', hue: 205, blocks: ['memory'] },
      { id: 'senses', name: '感官', en: 'SENSES', note: '语音 · 识图', hue: 300, blocks: ['voice', 'vision'] },
      { id: 'other', name: '其他', en: 'OTHER', note: '时机 · 表达 · 黑话 · 表情 · 收尾 · 设置 · 支撑', hue: 220,
        blocks: ['attention', 'expression', 'lexicon', 'sticker', 'closure', 'settings', 'support'] },
    ];

    const LANES = [
      { r: 150, periodSec: 190, dir: 1, cap: 20 },
      { r: 208, periodSec: 260, dir: -1, cap: 28 },
      { r: 266, periodSec: 340, dir: 1, cap: 36 },
    ];
    const LANE_TOTAL = LANES.reduce((n, l) => n + l.cap, 0);

    const capOf = (blockId) => (KERNEL_DATA.blocks[blockId] || { capabilities: [] }).capabilities;
    const settingsOf = (blockId) => (KERNEL_DATA.settings || []).filter((s) => s.block === blockId);

    const CSS = `
.sc-root{position:relative;height:100%;min-height:560px;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;
  background:radial-gradient(120% 90% at 50% 8%, #0b1b33 0%, #060d1a 46%, #03060d 100%);
  color:#cfe6ff;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;
  box-shadow:inset 0 0 90px rgba(29,78,216,.20), inset 0 0 2px rgba(56,189,248,.5)}
.sc-root *{box-sizing:border-box}
/* 背景：原图完整显示（contain，不裁人），边缘径向淡出 */
.sc-bg{position:absolute;inset:0;z-index:0;pointer-events:none;
  background-image:var(--bg);
  background-size:cover;
  background-position:50% 50%;
  transform:none;
  background-repeat:no-repeat;
  opacity:.72;
  mask-image:radial-gradient(78% 86% at 50% 46%, #000 52%, rgba(0,0,0,.55) 78%, transparent 98%);
  -webkit-mask-image:radial-gradient(78% 86% at 50% 46%, #000 52%, rgba(0,0,0,.55) 78%, transparent 98%)}
.sc-bg::after{content:'';position:absolute;inset:0;
  background:linear-gradient(180deg, rgba(4,10,20,.34) 0%, rgba(4,10,20,.06) 48%, rgba(3,8,16,.52) 100%)}

.sc-paths{position:absolute;inset:0;z-index:1;pointer-events:none}

.sc-grid{z-index:1;position:absolute;inset:0;pointer-events:none;opacity:.16;
  background-image:linear-gradient(rgba(56,189,248,.24) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.24) 1px,transparent 1px);
  background-size:44px 44px;mask-image:radial-gradient(circle at 50% 45%,#000 30%,transparent 78%)}
.sc-scan{position:absolute;left:0;right:0;height:160px;pointer-events:none;z-index:2;
  background:linear-gradient(180deg,transparent,rgba(56,189,248,.06),transparent);animation:sc-scan 7s linear infinite}
@keyframes sc-scan{0%{top:-160px}100%{top:100%}}
.sc-hud{position:relative;z-index:8;display:flex;align-items:center;gap:12px;padding:13px 18px;
  border-bottom:1px solid rgba(56,189,248,.16);background:linear-gradient(180deg,rgba(8,20,38,.9),rgba(8,20,38,0))}
.sc-mark{width:10px;height:10px;border-radius:2px;background:#22d3ee;box-shadow:0 0 12px #22d3ee;animation:sc-blink 2.4s ease-in-out infinite}
@keyframes sc-blink{0%,100%{opacity:1}50%{opacity:.35}}
.sc-title{font-size:13px;letter-spacing:.28em;font-weight:700;color:#e6f4ff}
.sc-badge{font-size:10px;letter-spacing:.18em;padding:3px 8px;border-radius:999px;color:#7dd3fc;
  border:1px solid rgba(56,189,248,.35);background:rgba(14,116,144,.16)}
.sc-crumb{font-size:10.5px;letter-spacing:.2em;color:#67e8f9;cursor:pointer;background:none;border:0;padding:2px 4px}
.sc-crumb:hover{color:#e0f2fe;text-shadow:0 0 10px rgba(56,189,248,.9)}
.sc-spacer{flex:1}
.sc-clock{font-size:11px;letter-spacing:.16em;color:#7dd3fc;opacity:.9}
.sc-build{font-size:9px;letter-spacing:.14em;color:#3f6b92}
.sc-stage{position:relative;flex:1;min-height:0;overflow:hidden}

/* 转场 */
.sc-zoomwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  transition:transform .58s cubic-bezier(.22,.9,.24,1), opacity .48s ease}
.sc-zoomwrap.in{transform:scale(1.8);opacity:0}
.sc-zoomwrap.out{transform:scale(.3);opacity:0}
.sc-enter{animation:sc-enter .58s cubic-bezier(.2,.9,.2,1) both}
@keyframes sc-enter{from{transform:scale(.62);opacity:0}to{transform:scale(1);opacity:1}}

/* ┢�┢� 外层：内核核 + 外环 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
.sc-kernel{position:relative;width:min(62vh,470px);height:min(62vh,470px);min-width:320px;min-height:320px}
.sc-ksvg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.sc-arc-a{animation:sc-spin 16s linear infinite;transform-origin:180px 180px}
.sc-arc-b{animation:sc-spin 10s linear infinite reverse;transform-origin:180px 180px}
.sc-arc-c{animation:sc-spin 26s linear infinite;transform-origin:180px 180px}
@keyframes sc-spin{to{transform:rotate(360deg)}}
.sc-orbit{position:absolute;left:50%;top:50%;width:76%;height:76%;transform:translate(-50%,-50%);border-radius:50%;
  cursor:pointer;transition:transform .24s ease, box-shadow .24s ease, border-color .24s ease;
  border:1px solid rgba(56,189,248,.32)}
.sc-orbit:hover{transform:translate(-50%,-50%) scale(1.035);border-color:rgba(103,232,249,.85);
  box-shadow:0 0 28px rgba(56,189,248,.45), inset 0 0 26px rgba(56,189,248,.18)}
.sc-orbit .hint{position:absolute;left:50%;bottom:-26px;transform:translateX(-50%);white-space:nowrap;
  font-size:10px;letter-spacing:.24em;color:#4f7ea8;opacity:0;transition:opacity .2s}
.sc-orbit:hover .hint{opacity:1;color:#7dd3fc}
.sc-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;cursor:pointer;
  background:none;border:0;color:inherit;padding:0;transition:transform .22s ease}
.sc-core:hover{transform:translate(-50%,-50%) scale(1.05)}
.sc-pulse{position:absolute;left:50%;top:50%;width:190px;height:190px;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle,rgba(56,189,248,.30),transparent 70%);animation:sc-pulse 3.4s ease-in-out infinite;pointer-events:none}
@keyframes sc-pulse{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(.94)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}}
.sc-core-name{font-size:40px;font-weight:800;letter-spacing:.2em;color:#f2faff;
  text-shadow:0 0 26px rgba(56,189,248,.95),0 0 60px rgba(59,130,246,.55)}
.sc-core-en{margin-top:6px;font-size:10px;letter-spacing:.52em;color:#7dd3fc}
.sc-core-toggle{margin-top:14px;font-size:10px;letter-spacing:.26em;color:#4f7ea8}
.sc-core:hover .sc-core-toggle{color:#9fe7ff}
.sc-sweep2{position:absolute;left:50%;top:50%;width:104%;height:104%;transform:translate(-50%,-50%);
  border-radius:50%;pointer-events:none;opacity:.75;
  background:conic-gradient(from 0deg, rgba(56,189,248,.30), transparent 22%, transparent 74%, rgba(167,139,250,.22), transparent 96%);
  mask:radial-gradient(circle, transparent 54%, #000 56%, #000 100%);
  animation:sc-spin 17s linear infinite}
.sc-sat{position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);
  animation:sc-spin 44s linear infinite;pointer-events:none}
.sc-sat i{position:absolute;width:5px;height:5px;border-radius:50%;background:#a5f3fc;
  box-shadow:0 0 12px #67e8f9,0 0 26px rgba(103,232,249,.7);animation:sc-blink 3.4s ease-in-out infinite}
.sc-hint{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;letter-spacing:.26em;color:#4f7ea8}

/* ┢�┢� 内层：中央圆�?+ 左右两列菜单（网格布屢�，结构上不重叠） ┢�┢�┢�┢�┢� */
.sc-holo{position:absolute;inset:0;overflow:hidden}
.sc-holo-glow{position:absolute;inset:0;pointer-events:none;opacity:0;animation:sc-bloom-in 1s ease forwards;
  background:radial-gradient(46% 40% at 50% 50%, rgba(56,189,248,.16), transparent 72%)}
@keyframes sc-bloom-in{to{opacity:1}}

/* 三栏：左�?/ 中央圆盘 / 右列；列宽固定，永不越界 */
.sc-layout{position:absolute;inset:0;display:grid;
  grid-template-columns: var(--colw) minmax(0,1fr) var(--colw);
  --colw: clamp(196px, 17.5vw, 268px);
  gap: clamp(14px, 2vw, 34px);
  padding: clamp(12px, 2vh, 26px) clamp(14px, 2vw, 32px);
  align-items: center}
.sc-col{display:flex;flex-direction:column;justify-content:center;
  gap: clamp(8px, 1.15vh, 14px); min-height:0; height:100%}
.sc-center{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0;height:100%}

/* 中央圆盘：轻微后仰，整个塞在中间栏里 */
.sc-disc{position:relative;aspect-ratio:1;width:min(58vh, 100%);height:auto;max-height:100%;flex:0 0 auto;
  border-radius:50%;transform:rotateX(34deg);transform-origin:50% 50%;
  background:radial-gradient(circle at 50% 44%, rgba(20,52,92,.38), rgba(6,17,32,.30) 62%, rgba(3,8,16,.44));
  border:1px solid rgba(147,225,255,.42);
  box-shadow:inset 0 0 90px rgba(56,189,248,.12), inset 0 1px 0 rgba(210,246,255,.32),
    0 0 0 1px rgba(56,189,248,.16), 0 0 70px rgba(56,189,248,.18);
  overflow:hidden;animation:sc-disc-in .8s cubic-bezier(.2,.9,.2,1) both}
@keyframes sc-disc-in{from{opacity:0;transform:rotateX(0deg) scale(.9)}to{opacity:1;transform:rotateX(34deg) scale(1)}}
.sc-disc-grid{position:absolute;inset:0;border-radius:50%;pointer-events:none;opacity:.26;
  background-image:
    linear-gradient(rgba(125,211,252,.16) 1px, transparent 1px),
    linear-gradient(90deg, rgba(125,211,252,.16) 1px, transparent 1px);
  background-size:26px 26px;
  mask:radial-gradient(circle, #000 48%, rgba(0,0,0,.4) 76%, transparent 94%)}
.sc-disc-rings{position:absolute;inset:0;border-radius:50%;pointer-events:none;
  background:repeating-radial-gradient(circle at 50% 50%,
    rgba(147,225,255,.08) 0 1px, transparent 1px 34px)}
/* 心跳：硬切换，但收着点（不扎眼）：本�?36%，峰�?.9 */
.sc-heart{position:absolute;left:50%;top:50%;width:23%;aspect-ratio:1;
  transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;
  background:radial-gradient(circle, rgba(220,244,255,.85) 0%, rgba(170,225,250,.55) 24%, rgba(90,185,240,.28) 46%, rgba(56,189,248,.08) 62%, transparent 74%);
  filter:drop-shadow(0 0 5px rgba(150,230,255,.35)) drop-shadow(0 0 14px rgba(56,189,248,.2));
  animation:sc-beat 2s ease-in-out infinite;will-change:opacity,transform;opacity:0}
.sc-heart::after{content:'';position:absolute;inset:0;border-radius:50%;
  border:1px solid rgba(210,240,255,.4);
  animation:sc-beat-ring 2s ease-out infinite;opacity:0}
@keyframes sc-beat{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.86)}
  9%{opacity:.5;transform:translate(-50%,-50%) scale(1.12)}
  15%{opacity:.32;transform:translate(-50%,-50%) scale(1.02)}
  23%{opacity:.44;transform:translate(-50%,-50%) scale(1.08)}
  34%{opacity:0;transform:translate(-50%,-50%) scale(.9)}
  100%{opacity:0;transform:translate(-50%,-50%) scale(.86)}}
@keyframes sc-beat-ring{
  0%{opacity:0;transform:scale(.94)}
  11%{opacity:.32;transform:scale(1.06)}
  26%{opacity:0;transform:scale(1.3)}
  100%{opacity:0;transform:scale(1.3)}}

.sc-disc-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.sc-disc-core .a{font-size:clamp(16px,2vh,22px);font-weight:900;letter-spacing:.4em;color:#eaf9ff;
  text-shadow:0 0 18px rgba(125,211,252,1)}
.sc-disc-core .b2{margin-top:6px;font-size:9px;letter-spacing:.34em;color:#7dd3fc;opacity:.85}
.sc-sweep{position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);
  border-radius:50%;pointer-events:none;opacity:.42;
  background:conic-gradient(from 0deg, rgba(56,189,248,.34), transparent 26%, transparent 74%, rgba(56,189,248,.18), transparent 98%);
  mask:radial-gradient(circle, transparent 46%, #000 48%, #000 100%);
  animation:sc-spin 18s linear infinite}

/* 菜单按钮：统丢�高度、统丢�字号，flex 排布 �?不会重合、不会出�?*/
.sc-menu{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;
  width:100%;height:clamp(50px, 6.4vh, 72px);padding:0 clamp(10px,1vw,16px);
  cursor:pointer;text-align:left;border:0;color:#eaf9ff;
  background:linear-gradient(180deg, rgba(28,66,110,.34), rgba(7,20,38,.40));
  clip-path:polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  box-shadow:inset 0 0 0 1px rgba(147,225,255,.45), inset 0 0 24px rgba(125,211,252,.18);
  transition:transform .16s ease, box-shadow .18s ease, background .18s ease;
  opacity:0;animation:sc-menu-in .5s ease both;animation-delay:var(--rd, 0s)}
@keyframes sc-menu-in{from{opacity:0;transform:translateX(var(--dir, -8px))}to{opacity:1;transform:none}}
.sc-col.right .sc-menu{--dir: 8px}
.sc-menu:hover{transform:translateX(var(--hx, 6px));
  background:linear-gradient(180deg, rgba(58,120,178,.52), rgba(9,26,48,.58));
  box-shadow:inset 0 0 0 1px rgba(226,248,255,.95), inset 0 0 32px rgba(147,225,255,.34),
    0 0 26px rgba(56,189,248,.65)}
.sc-col.right .sc-menu:hover{--hx: -6px}
.sc-menu .nm{font-size:clamp(16px, 1.9vh, 22px);font-weight:900;letter-spacing:.1em;
  text-shadow:0 0 12px rgba(190,240,255,.9)}
.sc-menu .ct{font-size:clamp(9px,.95vh,11px);font-weight:700;color:#a9e2ff;opacity:.9;white-space:nowrap}
.sc-menu .bar{position:absolute;left:0;bottom:0;height:2px;width:38%;
  background:linear-gradient(90deg, rgba(226,248,255,.95), rgba(125,211,252,0))}
.sc-menu .tick{position:absolute;right:8px;top:50%;width:6px;height:6px;transform:translateY(-50%) rotate(45deg);
  border:1px solid rgba(198,240,255,.6)}
/* 指向圆盘的连接线 */
.sc-menu::after{content:'';position:absolute;top:50%;width:14px;height:1px;
  background:linear-gradient(90deg, rgba(198,240,255,.85), rgba(198,240,255,0))}
.sc-col.left .sc-menu::after{right:-14px;transform:scaleX(-1)}
.sc-col.right .sc-menu::after{left:-14px}

/* 四个大入口：同一张卡片、同一套边框/切角，只是更大、竖排文字 */
.sc-group{height:clamp(84px, 12vh, 132px);flex-direction:column;align-items:flex-start;justify-content:center;
  gap:3px;padding:0 clamp(14px,1.3vw,20px)}
.sc-group .nm{font-size:clamp(22px, 2.9vh, 34px);letter-spacing:.16em}
.sc-group .g-sub{font-size:clamp(9px,1.05vh,12px);font-weight:600;color:#9fd8f8;opacity:.9;
  letter-spacing:.04em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.sc-group .ct{position:absolute;right:clamp(12px,1.1vw,18px);top:12px}
.sc-group .tick{top:auto;bottom:12px}
.sc-group.solo{justify-content:center}
.sc-group.solo .nm{font-size:clamp(24px,3.2vh,38px)}

/* 组页：把这一组的区块再列成卡片；不是第五层，只是同一页的分组 */
.sc-group-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:14px}
.sc-subblock{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;
  min-height:clamp(64px,8vh,92px);padding:10px clamp(12px,1.2vw,18px);cursor:pointer;text-align:left;border:0;color:#eaf9ff;
  background:linear-gradient(180deg, rgba(28,66,110,.34), rgba(7,20,38,.40));
  clip-path:polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  box-shadow:inset 0 0 0 1px rgba(147,225,255,.38), inset 0 0 18px rgba(125,211,252,.12);
  transition:background .16s ease, box-shadow .18s ease, transform .16s ease}
.sc-subblock:hover{background:linear-gradient(180deg, rgba(58,120,178,.5), rgba(9,26,48,.56));
  box-shadow:inset 0 0 0 1px rgba(226,248,255,.9), inset 0 0 26px rgba(147,225,255,.3), 0 0 20px rgba(56,189,248,.45)}
.sc-subblock .nm{font-size:clamp(16px,2vh,22px);font-weight:900;letter-spacing:.1em}
.sc-subblock .en{font-size:9px;letter-spacing:.28em;color:#5f8fbb}
.sc-subblock .ct{position:absolute;right:10px;bottom:8px;font-size:10px;color:#a9e2ff}
.sc-group-note{margin-top:8px;font-size:11px;color:#8fb6da;letter-spacing:.06em}

/* 内层整体：进入后�?/ 逢�出前�?*/
.sc-tiltwrap{position:absolute;inset:0;perspective:1600px;perspective-origin:50% 45%}
.sc-tilt{position:absolute;inset:0;transform-origin:50% 45%;transform:rotateX(16deg);
  animation:sc-lean-in .62s cubic-bezier(.2,.9,.2,1) both}
@keyframes sc-lean-in{
  0%{opacity:0;transform:rotateX(0deg) scale(.965)}
  100%{opacity:1;transform:rotateX(16deg) scale(1)}}
.sc-tilt.out{animation:sc-lean-out .44s cubic-bezier(.4,0,.6,1) both}
@keyframes sc-lean-out{
  0%{opacity:1;transform:rotateX(16deg) scale(1)}
  100%{opacity:0;transform:rotateX(0deg) scale(.965)}}

/* 外层回来：淡�?+ 轻微前��落�?*/
.sc-kernel-in{animation:sc-kernel-in .5s cubic-bezier(.2,.9,.2,1) both}
@keyframes sc-kernel-in{
  0%{opacity:0;transform:rotateX(10deg) scale(.97)}
  100%{opacity:1;transform:rotateX(0deg) scale(1)}}

/* 适配器页：左侧可展开扩展�?+ 星环 */
.sc-adapters{position:absolute;inset:0;display:flex;align-items:stretch}
.sc-rail{position:relative;flex:0 0 auto;width:46px;overflow:hidden;z-index:6;
  transition:width .26s cubic-bezier(.2,.9,.2,1);
  background:linear-gradient(180deg, rgba(10,26,46,.94), rgba(4,10,20,.92));
  border-right:1px solid rgba(56,189,248,.18)}
.sc-rail.open{width:302px}
.sc-rail-tab{position:absolute;left:0;top:0;bottom:0;width:46px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;cursor:pointer;color:#8fd7ff;
  font-size:11px;letter-spacing:.34em;writing-mode:vertical-rl;text-orientation:mixed;
  border-right:1px solid rgba(56,189,248,.12)}
.sc-rail-tab:hover{color:#e0f7ff;background:rgba(56,189,248,.08)}
.sc-rail-tab .n{writing-mode:horizontal-tb;font-size:10px;letter-spacing:.1em;color:#67e8f9;
  border:1px solid rgba(103,232,249,.5);border-radius:999px;padding:0 6px}
.sc-rail-body{width:302px;height:100%;display:flex;flex-direction:column;padding:12px 12px 10px;gap:8px}
.sc-rail-hd{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid rgba(56,189,248,.16)}
.sc-rail-hd .t{font-size:12px;font-weight:800;letter-spacing:.22em;color:#eaf9ff}
.sc-rail-hd .x{margin-left:auto;cursor:pointer;color:#7dd3fc;font-size:12px;padding:2px 6px;border-radius:6px}
.sc-rail-hd .x:hover{background:rgba(56,189,248,.16)}
.sc-import{display:flex;align-items:center;justify-content:center;gap:8px;height:34px;border-radius:8px;
  cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.1em;color:#04202c;
  background:linear-gradient(90deg,#7dd3fc,#38bdf8);border:0}
.sc-import:hover{filter:brightness(1.12)}
.sc-rail-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
.sc-item{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:8px;
  border:1px solid rgba(56,189,248,.20);background:rgba(8,22,40,.72)}
.sc-item.off{opacity:.55}
.sc-item .nm{font-size:11.5px;font-weight:700;color:#eaf9ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-item .mt{font-size:9px;color:#6fa8cf;letter-spacing:.06em}
.sc-item .col{min-width:0;flex:1}
.sc-item .badge{font-size:8.5px;padding:1px 5px;border-radius:999px;border:1px solid rgba(103,232,249,.45);color:#9fe7ff}
.sc-item .act{flex:none;font-size:10px;padding:4px 8px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(125,211,252,.45);background:transparent;color:#bfe9ff;letter-spacing:.06em}
.sc-item .act:hover{background:rgba(56,189,248,.18);border-color:#9fe7ff}
.sc-item .act.warn{border-color:rgba(248,113,113,.5);color:#fecaca}
.sc-rail-tip{font-size:9.5px;line-height:1.6;color:#4f7ea8;letter-spacing:.04em}
.sc-toast{font-size:10px;color:#7dd3fc;min-height:14px}

.sc-holo-tip{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;
  letter-spacing:.26em;color:#5a86ad;z-index:5}

/* 区块�?*/
.sc-page{position:absolute;inset:0;overflow:auto;padding:22px 28px 28px;z-index:4}
.sc-page .top{display:flex;align-items:baseline;gap:12px;margin-bottom:6px}
.sc-page h2{margin:0;font-size:22px;letter-spacing:.16em;color:#f2faff}
.sc-page .en{font-size:10px;letter-spacing:.34em;color:#5f8fbb}
.sc-page .note{margin-top:6px;font-size:11px;color:#8fb6da;letter-spacing:.06em}
.sc-sect{margin-top:18px}
.sc-sect h3{margin:0 0 8px;font-size:10px;letter-spacing:.28em;color:#5f8fbb;font-weight:600}
.sc-caps{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
.sc-cap{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:9px;
  border:1px solid rgba(56,189,248,.12);background:rgba(6,16,32,.5);font-size:11px;line-height:1.6;color:#a9cbe8}
.sc-cap .d{width:7px;height:7px;border-radius:50%;margin-top:5px;flex:none;background:#22c55e;box-shadow:0 0 8px #22c55e}
.sc-cap.partial .d{background:#eab308;box-shadow:0 0 8px #eab308}
.sc-cap.missing .d{background:#64748b;box-shadow:none}
.sc-cap .ev{display:block;font-size:9px;color:#5f8fbb;margin-top:2px}
.sc-set{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.sc-item{padding:12px 14px;border-radius:11px;border:1px solid rgba(56,189,248,.18);
  background:linear-gradient(168deg, rgba(14,34,60,.75), rgba(4,10,20,.8))}
.sc-item .k{font-size:11.5px;color:#eaf7ff;letter-spacing:.08em}
.sc-item .v{margin-top:6px;font-size:19px;color:#7dd3fc;letter-spacing:.06em}
.sc-item .v small{font-size:10px;color:#5f8fbb;margin-left:6px;letter-spacing:.06em}
.sc-item .c{margin-top:6px;font-size:10px;line-height:1.6;color:#7f9fbd}
.sc-item .o{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.sc-item .o span{font-size:9.5px;padding:1px 7px;border-radius:999px;border:1px solid rgba(56,189,248,.28);color:#8fb6da}
.sc-item .o span.cur{border-color:rgba(103,232,249,.8);color:#e0f2fe;background:rgba(56,189,248,.16)}
.sc-empty{font-size:11px;color:#5f8fbb}
.sc-backlink{margin-top:22px;padding:7px 14px;border-radius:8px;border:1px solid rgba(56,189,248,.35);
  background:transparent;color:#9fd8ff;font-size:11.5px;cursor:pointer;letter-spacing:.1em}
.sc-backlink:hover{background:rgba(56,189,248,.12)}

/* 记忆页：使用说明 / 读取方式 / 双 tab */
.sc-mem-actions{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 4px}
.sc-btn{height:34px;padding:0 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.08em;
  display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;text-decoration:none;
  color:#04202c;border:0;background:linear-gradient(90deg,#7dd3fc,#38bdf8)}
.sc-btn:hover{filter:brightness(1.1)}
.sc-btn.ghost{color:#bfe9ff;background:transparent;border:1px solid rgba(56,189,248,.38)}
.sc-btn.ghost:hover{background:rgba(56,189,248,.12)}
.sc-btn:disabled{opacity:.45;cursor:not-allowed;filter:none}
.sc-mem-tabs{display:flex;gap:8px;margin-top:16px;border-bottom:1px solid rgba(56,189,248,.18)}
.sc-mem-tab{padding:8px 14px;background:transparent;border:0;color:#7fa9c9;font-size:13px;font-weight:800;
  letter-spacing:.1em;cursor:pointer;border-bottom:2px solid transparent}
.sc-mem-tab.on{color:#eaf9ff;border-bottom-color:#22d3ee}
.sc-mem-subtabs{display:flex;gap:8px;margin-top:12px}
.sc-mem-sub{padding:5px 11px;border-radius:999px;border:1px solid rgba(56,189,248,.25);background:transparent;
  color:#8fb6da;font-size:11px;cursor:pointer}
.sc-mem-sub.on{color:#04202c;background:#7dd3fc;border-color:#7dd3fc;font-weight:700}
.sc-mem-card{margin-top:12px;padding:12px 14px;border-radius:12px;border:1px solid rgba(56,189,248,.22);
  background:linear-gradient(180deg,rgba(12,30,54,.72),rgba(5,14,28,.72))}
.sc-mem-card h4{margin:0 0 8px;font-size:12px;letter-spacing:.14em;color:#bfe9ff}
.sc-mem-card .hint{font-size:10.5px;color:#6f98b8;line-height:1.6}
.sc-mem-status{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}
.sc-mem-status b{display:block;font-size:18px;color:#eaf9ff;letter-spacing:.04em}
.sc-mem-status span{font-size:10px;color:#6f98b8;letter-spacing:.08em}
.sc-mem-list{display:flex;flex-direction:column;gap:7px;margin-top:8px;max-height:360px;overflow:auto;padding-right:2px}
.sc-mem-item{padding:9px 11px;border-radius:9px;border:1px solid rgba(56,189,248,.16);background:rgba(6,18,34,.66)}
.sc-mem-item .txt{font-size:12px;line-height:1.55;color:#d6efff;white-space:pre-wrap;word-break:break-word}
.sc-mem-item .meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:9.5px;color:#5f8fbb;letter-spacing:.06em}
.sc-mem-item .meta .imp{color:#7dd3fc}
.sc-src{display:inline-flex;align-items:center;gap:4px;font-size:9px;line-height:1.5;letter-spacing:.06em;
  padding:1px 6px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.sc-src i{font-style:normal;font-weight:800;font-size:8.5px;min-width:9px;text-align:center;opacity:.95}
.sc-space-tip .sc-src{margin-top:2px}
.sc-mem-empty{padding:18px;border-radius:10px;border:1px dashed rgba(56,189,248,.25);
  color:#6f98b8;font-size:11.5px;text-align:center;margin-top:8px}
.sc-mem-warn{padding:9px 11px;border-radius:9px;border:1px solid rgba(234,179,8,.35);
  background:rgba(66,44,8,.35);color:#fde68a;font-size:10.5px;line-height:1.6;margin-top:8px}
.sc-mem-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin-top:8px}
.sc-mem-slot{padding:10px;border-radius:9px;border:1px solid rgba(56,189,248,.18);background:rgba(6,18,34,.62)}
.sc-mem-slot .t{font-size:11.5px;font-weight:700;color:#d6efff}
.sc-mem-slot .s{font-size:9.5px;color:#6f98b8;margin-top:3px}
.sc-mem-provider{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.sc-mem-field{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.sc-mem-field label{font-size:10px;color:#6f98b8;letter-spacing:.08em}
.sc-mem-field input{height:30px;border-radius:7px;border:1px solid rgba(56,189,248,.22);
  background:rgba(3,12,24,.72);color:#cfe6ff;font-size:11.5px;padding:0 9px;outline:none}
.sc-mem-field input:disabled{opacity:.45}
.sc-modal-mask{position:fixed;inset:0;z-index:50;background:rgba(2,7,14,.72);display:flex;align-items:center;justify-content:center}
.sc-modal{width:min(460px,90vw);border-radius:16px;border:1px solid rgba(125,211,252,.45);
  background:linear-gradient(180deg,rgba(14,34,60,.98),rgba(5,14,28,.98));
  box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 0 0 1px rgba(210,246,255,.08);padding:18px 20px}
.sc-modal h3{margin:0 0 6px;font-size:15px;letter-spacing:.14em;color:#eaf9ff}
.sc-modal .sub{font-size:10.5px;color:#6f98b8;line-height:1.6}
.sc-modal .opt{display:flex;gap:9px;align-items:flex-start;margin-top:10px;padding:9px 10px;border-radius:9px;
  border:1px solid rgba(56,189,248,.2);background:rgba(6,18,34,.6);cursor:pointer}
.sc-modal .opt.on{border-color:#22d3ee;background:rgba(14,116,144,.22)}
.sc-modal .opt .k{font-size:12px;font-weight:700;color:#d6efff}
.sc-modal .opt .d{font-size:10px;color:#6f98b8;line-height:1.5;margin-top:2px}
.sc-modal .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}

/* 记忆页 v0.26：数据源 / 状态 / 动作 / 作业 / 索引 / 设置 */
.sc-mem-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.sc-mem-toolbar .sc-spacer{flex:1}
.sc-mem-count{font-size:10.5px;letter-spacing:.08em;color:#8fb6da}
.sc-mem-source{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;letter-spacing:.08em;color:#7dd3fc;
  border:1px solid rgba(56,189,248,.28);border-radius:999px;padding:2px 8px;white-space:nowrap}
.sc-mem-source i{width:6px;height:6px;border-radius:50%;background:#22d3ee;box-shadow:0 0 8px #22d3ee}
.sc-mem-source.ok{color:#86efac;border-color:rgba(34,197,94,.4)}
.sc-mem-source.ok i{background:#22c55e;box-shadow:0 0 8px #22c55e}
.sc-mem-source.warn{color:#fde68a;border-color:rgba(234,179,8,.45)}
.sc-mem-source.warn i{background:#eab308;box-shadow:none}
.sc-mem-source.off{color:#9aa9bb;border-color:rgba(148,163,184,.35)}
.sc-mem-source.off i{background:#64748b;box-shadow:none}
.sc-mem-banner{margin-top:10px;padding:8px 11px;border-radius:9px;font-size:10.5px;line-height:1.6;
  border:1px solid rgba(56,189,248,.25);background:rgba(8,30,54,.55);color:#bfe9ff}
.sc-mem-banner.warn{border-color:rgba(234,179,8,.4);background:rgba(66,44,8,.32);color:#fde68a}
.sc-mem-note{margin-top:10px;font-size:10px;line-height:1.7;color:#5f8fbb;letter-spacing:.04em}
.sc-mem-card-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.sc-mem-card-hd h4{margin:0}
.sc-mem-card-hd .sc-spacer{flex:1}
.sc-mem-state{margin-top:10px;padding:12px 14px;border-radius:10px;border:1px solid rgba(56,189,248,.25);
  background:rgba(6,18,34,.7);color:#bfe9ff;font-size:11px;line-height:1.7}
.sc-mem-state.loading{display:flex;align-items:center;gap:9px;color:#8fb6da}
.sc-mem-state.err{border-color:rgba(248,113,113,.42);background:rgba(48,10,16,.42)}
.sc-mem-state.unknown{border-color:rgba(234,179,8,.42);background:rgba(56,40,8,.36)}
.sc-mem-state.off{border-color:rgba(148,163,184,.35);background:rgba(20,28,40,.5);color:#a7b6c9}
.sc-mem-state.compact{padding:8px 11px;margin-top:6px}
.sc-mem-state .ttl{font-size:11.5px;font-weight:800;letter-spacing:.1em;color:#fca5a5;margin-bottom:3px}
.sc-mem-state.unknown .ttl{color:#fde68a}
.sc-mem-state.off .ttl{color:#cbd5e1}
.sc-mem-state .msg{color:#e2e8f0}
.sc-mem-state .meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:9.5px;color:#8fb6da}
.sc-mem-state code{font-family:ui-monospace,"Cascadia Code",monospace;font-size:9.5px;color:#7dd3fc;
  background:rgba(2,10,20,.6);border-radius:4px;padding:1px 5px}
.sc-mem-state .sc-btn{margin-top:8px}
.sc-spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(125,211,252,.25);border-top-color:#22d3ee;
  display:inline-block;flex:none;animation:sc-spin .8s linear infinite}
.sc-mem-job{margin-top:10px;padding:9px 11px;border-radius:9px;border:1px solid rgba(56,189,248,.3);
  background:rgba(8,30,54,.6);font-size:10.5px;color:#bfe9ff}
.sc-mem-job .hd{display:flex;align-items:center;gap:10px;justify-content:space-between}
.sc-mem-job .hd b{font-size:11px;letter-spacing:.08em;color:#e0f2fe}
.sc-mem-job .bar{margin-top:7px;height:5px;border-radius:999px;background:rgba(2,12,24,.8);overflow:hidden}
.sc-mem-job .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#7dd3fc);transition:width .3s ease}
.sc-mem-job .ft{margin-top:6px;font-size:9px;color:#5f8fbb;word-break:break-all}
.sc-mem-job.done{border-color:rgba(34,197,94,.45);color:#bbf7d0}
.sc-mem-job .sc-mem-state{margin-top:0;border:0;background:transparent;padding:0}
@keyframes sc-job-slide{from{margin-left:0}to{margin-left:62%}}
.sc-mem-row{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;
  padding:9px 0;border-top:1px solid rgba(56,189,248,.1)}
.sc-mem-row .k{font-size:11.5px;font-weight:700;color:#d6efff;letter-spacing:.06em}
.sc-mem-row .hint{margin-top:2px}
.sc-mem-row .sc-mem-actions{margin:0}
.sc-mem-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.sc-mem-input{height:30px;min-width:180px;border-radius:7px;border:1px solid rgba(56,189,248,.22);
  background:rgba(3,12,24,.72);color:#cfe6ff;font-size:11.5px;padding:0 9px;outline:none}
.sc-mem-input:focus{border-color:rgba(103,232,249,.75)}
.sc-mem-input:disabled{opacity:.45}
.sc-mem-index{margin-top:8px;border:1px solid rgba(56,189,248,.16);border-radius:9px;overflow:hidden}
.sc-mem-index .tr,.sc-mem-index .hd{display:grid;grid-template-columns:minmax(150px,1fr) 70px 70px 58px 78px;
  gap:8px;align-items:center;padding:7px 10px;font-size:10.5px}
.sc-mem-index .hd{color:#5f8fbb;font-size:9px;letter-spacing:.12em;background:rgba(4,14,26,.7)}
.sc-mem-index .tr{border-top:1px solid rgba(56,189,248,.1);color:#a9c8e6}
.sc-mem-index .tr .nm{color:#d6efff;font-family:ui-monospace,"Cascadia Code",monospace;font-size:10px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-mem-index .tr .nm i{font-style:normal;margin-left:6px;font-size:8.5px;color:#67e8f9;
  border:1px solid rgba(103,232,249,.5);border-radius:999px;padding:0 5px}
.sc-mem-index .tr .sc-btn{height:24px;padding:0 9px;font-size:9.5px;justify-self:end}
.sc-mem-confirm{margin-top:8px;padding:9px 11px;border-radius:9px;border:1px solid rgba(234,179,8,.45);
  background:rgba(66,44,8,.32);color:#fde68a;font-size:10.5px;line-height:1.6}
.sc-mem-confirm .sc-mem-actions{margin-top:7px}
.sc-mem-slot-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.sc-mem-slot.occupied{border-color:rgba(103,232,249,.4)}
.sc-mem-pill{font-size:9px;letter-spacing:.08em;border-radius:999px;padding:1px 7px;
  border:1px solid rgba(103,232,249,.4);color:#9fe7ff}
.sc-mem-pill.ok{border-color:rgba(34,197,94,.5);color:#86efac}
.sc-mem-pill.warn{border-color:rgba(234,179,8,.5);color:#fde68a}
.sc-mem-pill.off{border-color:rgba(148,163,184,.4);color:#9aa9bb}
.sc-mem-inline-ok{margin-top:7px;font-size:10px;color:#86efac}
.sc-mem-inline-err{margin-top:7px;font-size:10px;color:#fca5a5}
.sc-mem-provider .sc-mem-sub{position:relative}
.sc-mem-provider .sc-mem-sub .dot{display:inline-block;width:5px;height:5px;border-radius:50%;margin-left:5px;
  background:#22c55e;box-shadow:0 0 6px #22c55e;vertical-align:middle}
.sc-mem-setrow{display:grid;grid-template-columns:minmax(220px,1fr) minmax(210px,260px);gap:14px;
  padding:11px 0;border-top:1px solid rgba(56,189,248,.12)}
.sc-mem-setrow.locked{opacity:.78}
.sc-mem-setrow .k{font-size:11.5px;font-weight:700;color:#eaf7ff;letter-spacing:.05em}
.sc-mem-setrow .k .tag{font-style:normal;margin-left:6px;font-size:8.5px;padding:0 5px;border-radius:999px;
  border:1px solid rgba(125,211,252,.35);color:#8fb6da;vertical-align:middle}
.sc-mem-setrow .k .tag.grp{border-color:rgba(167,139,250,.4);color:#c4b5fd}
.sc-mem-setrow .d{margin-top:3px;font-size:10px;line-height:1.6;color:#8fb6da}
.sc-mem-setrow .c{margin-top:3px;font-size:9.5px;line-height:1.6;color:#5f8fbb}
.sc-mem-setrow .w{margin-top:3px;font-size:9.5px;color:#fde68a}
.sc-mem-setrow .r{margin-top:4px;font-size:9.5px;color:#fca5a5}
.sc-mem-setrow .ctl{display:flex;flex-direction:column;gap:7px;align-items:flex-start}
.sc-mem-setrow .ctl .row{display:flex;gap:6px;flex-wrap:wrap}
.sc-mem-seg{display:inline-flex;border:1px solid rgba(56,189,248,.28);border-radius:8px;overflow:hidden}
.sc-mem-seg button{padding:4px 10px;border:0;background:transparent;color:#8fb6da;font-size:10.5px;cursor:pointer}
.sc-mem-seg button.on{background:rgba(56,189,248,.22);color:#eaf9ff;font-weight:700}
.sc-mem-seg button:disabled{cursor:not-allowed;opacity:.5}
.sc-mem-switch{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 9px;border-radius:999px;
  border:1px solid rgba(56,189,248,.3);background:transparent;color:#8fb6da;font-size:10.5px;cursor:pointer}
.sc-mem-switch i{width:24px;height:13px;border-radius:999px;background:rgba(100,116,139,.5);position:relative;
  transition:background .16s}
.sc-mem-switch i::after{content:'';position:absolute;left:2px;top:2px;width:9px;height:9px;border-radius:50%;
  background:#cbd5e1;transition:transform .16s}
.sc-mem-switch.on{border-color:rgba(103,232,249,.6);color:#e0f2fe}
.sc-mem-switch.on i{background:rgba(34,211,238,.45)}
.sc-mem-switch.on i::after{transform:translateX(11px);background:#e0f2fe}
.sc-mem-switch:disabled{cursor:not-allowed;opacity:.5}
.sc-mem-snapshot{margin-top:14px;padding:10px 12px;border-radius:10px;border:1px dashed rgba(148,163,184,.4);
  background:rgba(10,18,30,.5)}
.sc-mem-snapshot .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sc-mem-snapshot .hd b{font-size:10.5px;letter-spacing:.1em;color:#cbd5e1}
.sc-mem-snapshot .hd span{font-size:9.5px;color:#64748b}
.sc-mem-snapshot .sc-mem-status{margin-top:8px}
.sc-mem-snapshot .sc-mem-list{max-height:240px}
.sc-mem-unknown{font-size:10.5px;color:#9aa9bb}
.sc-mem-wip{display:inline-block;margin-bottom:8px;padding:2px 8px;border-radius:999px;font-size:9.5px;
  letter-spacing:.16em;border:1px solid rgba(234,179,8,.45);color:#fde68a;background:rgba(66,44,8,.3)}
.sc-guide .sc-mem-card{margin-top:14px}

/* 记忆空间：3D 投影画布（只读） */
.sc-space-wrap{position:relative;margin-top:12px;border-radius:12px;overflow:hidden;
  border:1px solid rgba(56,189,248,.22);
  background:radial-gradient(70% 70% at 50% 45%, rgba(14,42,74,.55), rgba(4,12,24,.85));
  box-shadow:inset 0 0 40px rgba(56,189,248,.08)}
.sc-space-canvas{display:block;width:100%;height:clamp(320px,46vh,520px);cursor:grab;touch-action:none}
.sc-space-canvas:active{cursor:grabbing}
.sc-space-tip{position:absolute;transform:translate(-50%,-100%);pointer-events:none;max-width:300px;
  padding:6px 8px;border-radius:8px;border:1px solid rgba(103,232,249,.45);
  background:rgba(4,14,28,.96);color:#d6efff;font-size:10px;line-height:1.6;
  box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:3}
.sc-space-tip b{display:block;color:#eaf9ff;font-size:10.5px;margin-bottom:2px}
.sc-space-tip span{color:#7dd3fc;margin-right:6px}
.sc-space-tip div{color:#bfe9ff;margin-top:2px}
.sc-space-legend{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;
  margin-top:6px;font-size:9.5px;color:#5f8fbb;letter-spacing:.04em}
.sc-space-idle{margin-top:10px;padding:18px;border-radius:10px;border:1px dashed rgba(56,189,248,.22);
  color:#6f98b8;font-size:11px;text-align:center}
.sc-space-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;
  font-size:9.5px;color:#8fb6da}
.sc-space-meta span{white-space:nowrap}
.sc-space-plain{display:flex;gap:6px 18px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;border-radius:9px;
  border:1px solid rgba(56,189,248,.14);background:rgba(8,26,48,.42);
  font-size:10px;line-height:1.65;color:#8fb6da}
.sc-space-plain span{white-space:normal}
.sc-space-plain b{color:#bfe9ff;font-weight:700;margin-right:5px}
.sc-space-detail{margin-top:8px;padding:9px 11px;border-radius:9px;border:1px solid rgba(56,189,248,.2);
  background:rgba(6,18,34,.6)}
.sc-space-detail .hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:10px;color:#7dd3fc}
.sc-space-detail .hd b{color:#e0f2fe;font-size:10.5px}
.sc-space-detail .txt{margin-top:5px;font-size:11.5px;line-height:1.65;color:#d6efff;white-space:pre-wrap;word-break:break-word}
.sc-space-detail .meta{margin-top:4px;font-size:9.5px;color:#5f8fbb;letter-spacing:.04em}
.sc-mem-inline select.sc-mem-input{min-width:260px;max-width:100%}

/* 语音控制面 */
.sc-voice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin-top:10px}
.sc-voice-card{border:1px solid rgba(56,189,248,.2);border-radius:14px;padding:14px;
  background:linear-gradient(150deg,rgba(8,24,44,.92),rgba(4,12,24,.9));min-width:0}
.sc-voice-card.cloud{border-color:rgba(167,139,250,.24)}
.sc-voice-card .hd{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.sc-voice-card h3{margin:0;font-size:15px;letter-spacing:.1em;color:#eaf9ff}
.sc-voice-card .sub{font-size:9.5px;color:#5f8fbb;margin-top:3px;letter-spacing:.04em}
.sc-voice-card .badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.sc-voice-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.sc-voice-actions .sc-btn{height:28px;padding:0 10px;font-size:10px}
.sc-btn.danger{color:#fecaca;background:rgba(80,20,28,.35);border:1px solid rgba(248,113,113,.5)}
.sc-btn.danger:hover{background:rgba(120,28,38,.5)}
.sc-voice-voices{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;font-size:9.5px;color:#8fb6da;align-items:center}
.sc-voice-voices .k{color:#5f8fbb;letter-spacing:.1em}
.sc-voice-voices .v{padding:1px 7px;border-radius:999px;border:1px solid rgba(56,189,248,.24);color:#bfe9ff}
.sc-voice-about{margin-top:9px;font-size:10.5px;line-height:1.65;color:#8fb6da}
.sc-voice-note{margin-top:8px;font-size:9.5px;line-height:1.6;color:#5f8fbb}
.sc-voice-status{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;
  margin-top:12px;padding:12px 14px;border-radius:12px;border:1px solid rgba(56,189,248,.2);
  background:radial-gradient(80% 120% at 10% 0,rgba(14,80,110,.34),rgba(4,12,24,.7))}
.sc-voice-status-main b{font-size:13px;color:#eaf9ff;letter-spacing:.06em}
.sc-voice-status .meta{font-size:9.5px;color:#7dd3fc;margin-top:3px}
.sc-voice-status-note{font-size:9.5px;color:#5f8fbb;max-width:420px;line-height:1.6}
.sc-voice-notice{margin-top:9px;border-radius:10px;padding:8px 10px;font-size:10.5px;display:flex;gap:10px;align-items:center;justify-content:space-between}
.sc-voice-notice.ok{border:1px solid rgba(34,211,238,.3);background:rgba(8,60,74,.35);color:#cffafe}
.sc-voice-notice.err{border:1px solid rgba(248,113,113,.3);background:rgba(60,18,24,.35)}
.sc-voice-progress{margin-top:10px;padding:9px 10px;border-radius:10px;border:1px solid rgba(56,189,248,.18);background:rgba(5,18,34,.55)}
.sc-voice-progress .hd{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#bfe9ff}
.sc-voice-progress .hd span{color:#5f8fbb;font-variant-numeric:tabular-nums}
.sc-voice-progress .bar{height:5px;border-radius:999px;background:rgba(56,189,248,.14);overflow:hidden;margin-top:6px}
.sc-voice-progress .bar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#818cf8);transition:width .3s}
.sc-voice-progress .bar.indet i{width:35%;animation:sc-voice-indet 1.4s ease-in-out infinite}
@keyframes sc-voice-indet{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
.sc-voice-progress .err{margin-top:6px;font-size:10px;color:#fecaca;line-height:1.55}
.sc-voice-progress .meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:9.5px;color:#8fb6da}
.sc-voice-progress .log{margin:6px 0 0;max-height:96px;overflow:auto;font-size:9px;line-height:1.5;color:#8fb6da;white-space:pre-wrap}
.sc-voice-card .sc-mem-banner{margin-top:10px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sc-voice-err{margin-top:9px;padding:8px 10px;border-radius:9px;border:1px solid rgba(248,113,113,.3);background:rgba(60,18,24,.28);font-size:10px;color:#fecaca;line-height:1.6}
.sc-voice-err b{color:#fecaca;margin-right:6px}
.sc-voice-err .meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;color:#fca5a5;font-size:9px}
.sc-voice-cloud{margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(167,139,250,.2);background:rgba(10,14,34,.55)}
.sc-voice-cloud-hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:#e9d5ff}
.sc-voice-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;margin-top:10px}
.sc-voice-field{display:flex;flex-direction:column;gap:4px;font-size:9.5px;color:#8fb6da}
.sc-voice-field .sc-mem-input{width:100%;box-sizing:border-box}
.sc-voice-stats{display:flex;gap:6px 16px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:#bfe9ff}
.sc-voice-sample{margin-top:8px;padding:8px 10px;border-radius:9px;border:1px solid rgba(56,189,248,.18);background:rgba(5,18,34,.45)}
.sc-voice-sample .meta{font-size:9.5px;color:#5f8fbb}
.sc-voice-check{margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(56,189,248,.24);background:rgba(5,18,34,.6)}
.sc-voice-check .hd{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.sc-voice-check .hd b{font-size:12px;color:#eaf9ff}
.sc-voice-check .meta{font-size:9.5px;color:#5f8fbb;margin-top:4px;word-break:break-all}
.sc-voice-stage{margin-top:8px;padding:7px 9px;border-radius:8px;border:1px solid rgba(56,189,248,.14);font-size:10px;color:#bfe9ff}
.sc-voice-stage.bad{border-color:rgba(248,113,113,.3);background:rgba(60,18,24,.22)}
.sc-voice-stage b{margin-right:8px}
.sc-voice-stage span{color:#5f8fbb;font-variant-numeric:tabular-nums}
.sc-voice-stage code{margin-top:3px;display:inline-block}
.sc-voice-maint{margin-top:14px;border:1px solid rgba(248,113,113,.16);border-radius:10px;padding:9px 11px;background:rgba(30,12,18,.28)}
.sc-voice-maint summary{cursor:pointer;font-size:10.5px;color:#fca5a5;letter-spacing:.06em}
.sc-voice-maint-row{margin-top:9px;padding-top:8px;border-top:1px solid rgba(248,113,113,.12);font-size:10.5px;color:#e5e7eb}
.sc-voice-maint-row .meta{margin-top:4px;font-size:9px;color:#8b6b72;word-break:break-all}
.sc-voice-modal{width:min(680px,94vw);max-height:88vh;overflow:auto}
.sc-voice-packs-pick{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.sc-voice-inspect{margin-top:10px;padding:9px 10px;border-radius:9px;border:1px solid rgba(56,189,248,.18);background:rgba(5,18,34,.45)}
.sc-voice-inspect .meta{display:flex;gap:8px;flex-wrap:wrap;font-size:9.5px;color:#8fb6da;align-items:center}
.sc-voice-warn{margin-top:7px;font-size:9.5px;color:#fde68a;line-height:1.6}
.sc-voice-checkline{display:flex;gap:7px;align-items:center;margin-top:9px;font-size:10px;color:#fde68a}
.sc-voice-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#bfe9ff}
.sc-voice-grid .sc-mem-empty{grid-column:1/-1}
.sc-sect-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.sc-sect-hd h3{margin:0}

/* 语音控制面（本机 HTTP，不是旧桥） */
.sc-voicec-connect{margin-top:14px;padding:16px;border-radius:14px;border:1px solid rgba(56,189,248,.24);
  background:linear-gradient(150deg,rgba(8,24,44,.92),rgba(4,12,24,.9));max-width:760px}
.sc-voicec-connect .hd{display:flex;justify-content:space-between;gap:10px;align-items:center}
.sc-voicec-connect h3{margin:0;font-size:15px;letter-spacing:.1em;color:#eaf9ff}
.sc-voicec-connect .note{margin-top:6px;font-size:10.5px;line-height:1.65;color:#8fb6da}
.sc-voicec-code{margin:10px 0;padding:9px 10px;border-radius:8px;border:1px solid rgba(56,189,248,.18);
  background:rgba(3,10,20,.7);color:#bfe9ff;font-size:10px;line-height:1.6;white-space:pre-wrap;word-break:break-all}
.sc-voicec-field{display:flex;flex-direction:column;gap:4px;margin-top:9px;font-size:9.5px;color:#8fb6da}
.sc-voicec-field .sc-mem-input{width:100%;box-sizing:border-box}
.sc-voicec-note{margin-top:8px;font-size:9.5px;line-height:1.6;color:#5f8fbb}
.sc-voicec-note a{color:#7dd3fc;text-decoration:none;border-bottom:1px solid rgba(125,211,252,.35)}
.sc-voicec-note a:hover{color:#cffafe;border-bottom-color:rgba(207,250,254,.6)}
.sc-voicec-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}
.sc-voicec-actions .sc-btn{height:29px;padding:0 11px;font-size:10px}
.sc-voicec-warn{margin-top:9px;padding:7px 9px;border-radius:8px;border:1px solid rgba(251,191,36,.28);
  background:rgba(66,44,8,.25);color:#fde68a;font-size:10px;line-height:1.6}
.sc-voicec-status{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;
  margin-top:12px;padding:12px 14px;border-radius:12px;border:1px solid rgba(56,189,248,.2);
  background:radial-gradient(80% 120% at 10% 0,rgba(14,80,110,.34),rgba(4,12,24,.7))}
.sc-voicec-status .hd{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.sc-voicec-status b{font-size:12.5px;color:#eaf9ff}
.sc-voicec-status .meta{font-size:9.5px;color:#5f8fbb;margin-top:3px;word-break:break-all}
.sc-voicec-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-top:10px}
.sc-voicec-card{border:1px solid rgba(56,189,248,.2);border-radius:13px;padding:13px;
  background:linear-gradient(150deg,rgba(8,24,44,.9),rgba(4,12,24,.88))}
.sc-voicec-card.cloud{border-color:rgba(167,139,250,.24)}
.sc-voicec-card .hd{display:flex;justify-content:space-between;gap:9px;align-items:flex-start;flex-wrap:wrap}
.sc-voicec-card h3{margin:0;font-size:14px;letter-spacing:.08em;color:#eaf9ff}
.sc-voicec-card .sub{font-size:9.5px;color:#5f8fbb;margin-top:3px;word-break:break-all}
.sc-voicec-card .badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.sc-voicec-providers{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.sc-voicec-provider{padding:9px 10px;border-radius:10px;border:1px solid rgba(56,189,248,.16);background:rgba(5,18,34,.45)}
.sc-voicec-provider .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:10.5px;color:#bfe9ff}
.sc-voicec-provider .hd b{color:#eaf9ff}
.sc-voicec-provider .meta{display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:4px;font-size:9px;color:#5f8fbb;word-break:break-all}
.sc-voicec-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;margin-top:10px}
.sc-voicec-checkline{display:flex;gap:7px;align-items:center;margin-top:9px;font-size:10px;color:#8fb6da}
.sc-voicec-notice{margin-top:9px;border-radius:10px;padding:8px 10px;display:flex;gap:9px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sc-voicec-notice.ok{border:1px solid rgba(34,211,238,.3);background:rgba(8,60,74,.35);color:#cffafe;font-size:10.5px}
.sc-voicec-notice.err{border:1px solid rgba(248,113,113,.3);background:rgba(60,18,24,.35)}
.sc-voicec-empty{padding:18px;border-radius:10px;border:1px dashed rgba(56,189,248,.22);color:#6f98b8;font-size:11px;text-align:center}
.sc-voicec-unavailable{margin-top:12px;padding:16px;border-radius:14px;border:1px solid rgba(251,191,36,.3);
  background:linear-gradient(150deg,rgba(46,32,8,.55),rgba(8,18,30,.85));max-width:720px}
.sc-voicec-unavailable b{font-size:14px;color:#fde68a;letter-spacing:.08em}
.sc-voicec-modal{width:min(720px,94vw);max-height:90vh;overflow:auto}
.sc-voicec-pickrow{display:flex;gap:6px;align-items:center;margin-top:5px}
.sc-voicec-pickrow .sc-mem-input{flex:1;min-width:0}
.sc-voicec-pickrow .sc-btn{height:29px;padding:0 10px;font-size:9.5px;white-space:nowrap}
.sc-voicec-result{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#bfe9ff}
@media (max-width: 720px){
  .sc-voicec-form{grid-template-columns:1fr}
  .sc-voicec-grid{grid-template-columns:1fr}
  .sc-voicec-connect{padding:12px}
}
@media (max-width: 720px){
  .sc-mem-setrow{grid-template-columns:1fr}
  .sc-mem-index .hd{display:none}
  .sc-mem-index .tr{grid-template-columns:1fr 1fr;row-gap:4px}
  .sc-space-canvas{height:clamp(280px,42vh,460px)}
  .sc-mem-inline select.sc-mem-input{min-width:0;width:100%}
  .sc-voice-grid{grid-template-columns:1fr}
  .sc-voice-form{grid-template-columns:1fr}
  .sc-voice-status{align-items:flex-start}
  .sc-voice-modal{width:96vw}
}
@media (prefers-reduced-motion: reduce){
  .sc-spin{animation:none}
  .sc-mem-job .bar i{animation:none !important}
}

/* 星环 */
.sc-galaxy{position:absolute;inset:0}
.sc-neb{position:absolute;left:50%;top:46%;width:740px;height:740px;transform:translate(-50%,-50%);
  border-radius:50%;pointer-events:none;opacity:.55;
  background:radial-gradient(circle,rgba(30,64,175,.30),rgba(8,20,40,.06) 45%,transparent 66%)}
.sc-dust{position:absolute;inset:0;pointer-events:none;opacity:.55;
  background:radial-gradient(circle at 22% 30%,rgba(99,102,241,.16),transparent 40%),
             radial-gradient(circle at 78% 70%,rgba(14,165,233,.14),transparent 42%)}
.sc-lane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;
  border:1px dashed rgba(56,189,248,.16);pointer-events:none}
.sc-lane.solid{border-style:solid;border-color:rgba(56,189,248,.10)}
.sc-node{position:absolute;left:0;top:0;will-change:left,top;cursor:pointer;
  display:flex;align-items:center;gap:7px;padding:3px 5px;transform:translate(-50%,-50%);
  transition:transform .18s ease}
.sc-node:hover{transform:translate(-50%,-50%) scale(1.14)}
.sc-node .sc-o{width:20px;height:20px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 35% 30%,#e0f2fe,#38bdf8 55%,#1d4ed8 100%);
  box-shadow:0 0 12px rgba(56,189,248,.75);transition:box-shadow .2s}
.sc-node.off .sc-o{background:radial-gradient(circle at 35% 30%,#94a3b8,#334155 60%,#0f172a 100%);box-shadow:none;opacity:.75}
.sc-node:hover .sc-o{box-shadow:0 0 26px rgba(103,232,249,1)}
.sc-node .sc-nm{font-size:11px;letter-spacing:.08em;color:#bfe3ff;white-space:nowrap;
  background:rgba(6,16,32,.72);border:1px solid rgba(56,189,248,.18);border-radius:999px;padding:2px 8px}
.sc-node .sc-nm b{font-weight:700;color:#eaf7ff}
.sc-node .sc-nm i{font-style:normal;margin-left:6px;font-size:9.5px;color:#67e8f9}
.sc-core-adapt{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.sc-core-adapt .ring{width:150px;height:150px;border-radius:50%;margin:0 auto;
  background:radial-gradient(circle,rgba(56,189,248,.20),transparent 70%);animation:sc-pulse 3.4s ease-in-out infinite}
.sc-core-adapt .big{font-size:22px;font-weight:800;letter-spacing:.16em;color:#f2faff;text-shadow:0 0 24px rgba(56,189,248,.9)}
.sc-core-adapt .sub{margin-top:5px;font-size:9px;letter-spacing:.36em;color:#7dd3fc}
.sc-core-adapt .note{margin-top:10px;font-size:10.5px;color:#8fb6da}
.sc-card{position:absolute;right:16px;top:14px;width:250px;padding:12px 14px;border-radius:12px;
  border:1px solid rgba(56,189,248,.30);background:rgba(4,12,26,.94);box-shadow:0 10px 40px rgba(2,8,20,.7);
  animation:sc-card-in .22s ease both;z-index:6}
@keyframes sc-card-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.sc-card h4{margin:0 0 6px;font-size:13px;color:#eaf7ff;letter-spacing:.08em}
.sc-card .kv{display:flex;justify-content:space-between;font-size:10.5px;color:#8fb6da;padding:2px 0}
.sc-card .kv b{color:#cfe9ff;font-weight:600}
.sc-card .go{margin-top:9px;width:100%;padding:6px;border-radius:8px;cursor:pointer;font-size:11px;
  color:#04121f;background:linear-gradient(90deg,#67e8f9,#38bdf8);border:0;letter-spacing:.1em}
.sc-legend{position:absolute;left:16px;bottom:12px;font-size:9.5px;letter-spacing:.14em;color:#527ea6;line-height:1.7;pointer-events:none}
.sc-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:#38bdf8}
.sc-legend i.off{background:#475569}

/* 模块�?*/
.sc-module{position:absolute;inset:0;padding:26px 30px;overflow:auto}
.sc-module h2{margin:4px 0 6px;font-size:20px;letter-spacing:.1em;color:#eaf7ff}
.sc-module .sub{font-size:11px;letter-spacing:.18em;color:#5f8fbb}
.sc-chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
.sc-chip{font-size:10.5px;padding:4px 9px;border-radius:999px;border:1px solid rgba(56,189,248,.28);color:#9fc3e8}
.sc-box{border:1px solid rgba(56,189,248,.16);border-radius:12px;padding:16px 18px;background:rgba(6,16,32,.55);max-width:640px}
.sc-box p{margin:0 0 10px;font-size:12px;line-height:1.8;color:#8fb6da}

.sc-flow{position:relative;z-index:8;display:flex;align-items:center;gap:8px;padding:8px 18px;font-size:10px;
  letter-spacing:.16em;color:#5f8fbb;border-top:1px solid rgba(56,189,248,.10)}
.sc-pill{padding:2px 7px;border-radius:999px;border:1px solid rgba(56,189,248,.28);color:#7dd3fc}
`;

    /* ┢�┢� 星空 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function useStars(canvasRef) {
      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const g = canvas.getContext('2d');
        if (!g) return undefined;
        let raf = 0; let stopped = false;
        const stars = Array.from({ length: 150 }, () => ({
          x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.25,
          a: Math.random() * 0.6 + 0.2, tw: Math.random() * Math.PI * 2,
        }));
        const fit = () => {
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.max(1, Math.floor(rect.width * dpr));
          canvas.height = Math.max(1, Math.floor(rect.height * dpr));
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          return rect;
        };
        let rect = fit();
        const onResize = () => { rect = fit(); };
        window.addEventListener('resize', onResize);
        let t = 0;
        const draw = () => {
          if (stopped) return;
          t += 1;
          g.clearRect(0, 0, rect.width, rect.height);
          for (const s of stars) {
            const a = s.a * (0.55 + 0.45 * Math.sin(t * 0.02 + s.tw));
            g.beginPath();
            g.arc(s.x * rect.width, s.y * rect.height, s.r, 0, Math.PI * 2);
            g.fillStyle = `rgba(186,230,253,${Math.max(0.05, a)})`;
            g.fill();
          }
          raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
      }, [canvasRef]);
    }

    /* ┢�┢� 线�6�0动��光路：几条贝塞尔曲�?+ 流动光点 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function LightPaths() {
      const ref = useRef(null);

      useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        const g = canvas.getContext('2d');
        if (!g) return undefined;
        let raf = 0;
        let stopped = false;
        let rect = { width: 900, height: 700 };

        /* 固定几条"线�6�0"，不随机�?*/
        const paths = [
          { a: [0.02, 0.62], b: [0.28, 0.30], c: [0.58, 0.88], d: [0.99, 0.44], w: 1.1, sp: 0.035 },
          { a: [0.00, 0.24], b: [0.34, 0.10], c: [0.62, 0.52], d: [1.00, 0.18], w: 0.9, sp: 0.028 },
          { a: [0.10, 0.98], b: [0.36, 0.62], c: [0.70, 0.06], d: [0.92, 0.36], w: 1.3, sp: 0.022 },
          { a: [0.16, 0.06], b: [0.44, 0.46], c: [0.66, 0.74], d: [1.00, 0.60], w: 0.8, sp: 0.040 },
          { a: [0.04, 0.42], b: [0.30, 0.72], c: [0.58, 0.22], d: [0.98, 0.80], w: 1.0, sp: 0.018 },
        ];

        const fit = () => {
          const box = canvas.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.max(1, Math.floor(box.width * dpr));
          canvas.height = Math.max(1, Math.floor(box.height * dpr));
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          rect = { width: box.width, height: box.height };
        };
        fit();
        const onResize = () => fit();
        window.addEventListener('resize', onResize);

        const at = (pa, pb, pc, pd, t) => {
          const u = 1 - t;
          return {
            x: (u * u * u * pa[0] + 3 * u * u * t * pb[0] + 3 * u * t * t * pc[0] + t * t * t * pd[0]) * rect.width,
            y: (u * u * u * pa[1] + 3 * u * u * t * pb[1] + 3 * u * t * t * pc[1] + t * t * t * pd[1]) * rect.height,
          };
        };

        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const draw = () => {
          if (stopped) return;
          const t = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000;
          g.clearRect(0, 0, rect.width, rect.height);

          for (const pa of paths) {
            /* 静��细�?*/
            g.beginPath();
            for (let i = 0; i <= 64; i += 1) {
              const pt = at(pa.a, pa.b, pa.c, pa.d, i / 64);
              if (i === 0) g.moveTo(pt.x, pt.y); else g.lineTo(pt.x, pt.y);
            }
            g.strokeStyle = 'rgba(96,165,250,.16)';
            g.lineWidth = pa.w;
            g.stroke();

            /* 流动高光�?*/
            const head = (t * pa.sp + pa.sp * 7) % 1;
            for (let k = 0; k < 14; k += 1) {
              const tt = head - k * 0.006;
              if (tt < 0) continue;
              const pt = at(pa.a, pa.b, pa.c, pa.d, tt);
              const a = (1 - k / 14) * 0.75;
              g.beginPath();
              g.arc(pt.x, pt.y, 1.7, 0, Math.PI * 2);
              g.fillStyle = 'rgba(190,235,255,' + a.toFixed(3) + ')';
              g.fill();
            }

            /* 端点小方�?*/
            const end = at(pa.a, pa.b, pa.c, pa.d, head);
            g.strokeStyle = 'rgba(190,235,255,.7)';
            g.lineWidth = 1;
            g.strokeRect(end.x - 2.5, end.y - 2.5, 5, 5);
          }

          raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => {
          stopped = true;
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
        };
      }, []);

      return h('canvas', { ref, className: 'sc-paths' });
    }

    /* ┢�┢� 侧边栏图�?┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function Icon(props) {
      const size = props && props.size ? props.size : 22;
      const active = !!(props && props.active);
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
        style: { display: 'block', filter: active ? 'drop-shadow(0 0 6px rgba(56,189,248,.9))' : 'none' },
      },
        h('circle', { cx: 12, cy: 12, r: 8.4, fill: 'none', stroke: active ? '#67e8f9' : '#38bdf8', strokeWidth: 1.7, strokeDasharray: '33 14', strokeLinecap: 'round', transform: 'rotate(-30 12 12)' }),
        h('circle', { cx: 12, cy: 12, r: 5.2, fill: 'none', stroke: '#3b82f6', strokeWidth: 1, opacity: 0.55 }),
        h('circle', { cx: 12, cy: 12, r: 2.1, fill: active ? '#e0f2fe' : '#93c5fd' }),
      );
    }

    /* ┢�┢� 外层：内�?┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function KernelOuter(props) {
      const { onInside, onOutside, tick } = props;
      return h('div', { className: 'sc-kernel' },
        h('svg', { className: 'sc-ksvg', viewBox: '0 0 360 360' },
          h('defs', null,
            h('linearGradient', { id: 'sc-g1', x1: '0', y1: '0', x2: '1', y2: '1' },
              h('stop', { offset: '0%', stopColor: '#22d3ee' }),
              h('stop', { offset: '60%', stopColor: '#3b82f6' }),
              h('stop', { offset: '100%', stopColor: '#a78bfa' })),
            h('radialGradient', { id: 'sc-core', cx: '50%', cy: '50%', r: '50%' },
              h('stop', { offset: '0%', stopColor: 'rgba(240,249,255,.98)' }),
              h('stop', { offset: '42%', stopColor: 'rgba(56,189,248,.55)' }),
              h('stop', { offset: '100%', stopColor: 'rgba(29,78,216,0)' }))),
          h('circle', { cx: 180, cy: 180, r: 150, fill: 'none', stroke: 'rgba(56,189,248,.14)', strokeWidth: 1 }),
          h('g', { className: 'sc-arc-a' }, h('circle', { cx: 180, cy: 180, r: 140, fill: 'none', stroke: 'url(#sc-g1)', strokeWidth: 2.5, strokeLinecap: 'round', strokeDasharray: '150 730' })),
          h('g', { className: 'sc-arc-b' }, h('circle', { cx: 180, cy: 180, r: 124, fill: 'none', stroke: '#38bdf8', strokeWidth: 1.6, strokeLinecap: 'round', strokeDasharray: '44 150 20 590', opacity: 0.7 })),
          h('g', { className: 'sc-arc-c' }, h('circle', { cx: 180, cy: 180, r: 104, fill: 'none', stroke: '#818cf8', strokeWidth: 1, strokeDasharray: '6 10', opacity: 0.6 })),
          h('circle', { cx: 180, cy: 180, r: 78, fill: 'url(#sc-core)' }),
          h('g', { opacity: '0.55' }, Array.from({ length: 72 }, (_, i) => {
            const a = (i / 72) * Math.PI * 2;
            const r1 = 150;
            const r2 = i % 6 === 0 ? 162 : 156;
            return h('line', {
              key: 't' + i,
              x1: 180 + Math.cos(a) * r1, y1: 180 + Math.sin(a) * r1,
              x2: 180 + Math.cos(a) * r2, y2: 180 + Math.sin(a) * r2,
              stroke: i % 6 === 0 ? 'rgba(103,232,249,.75)' : 'rgba(56,189,248,.35)',
              strokeWidth: i % 6 === 0 ? 1.4 : 0.8,
            });
          }))),
        h('div', { className: 'sc-pulse' }),
        h('div', { className: 'sc-heart outer' }),
        h('div', { className: 'sc-sweep2' }),
        h('div', { className: 'sc-sat' },
          h('i', { style: { left: '50%', top: '2%' } }),
          h('i', { style: { left: '97%', top: '62%', animationDelay: '-1s' } }),
          h('i', { style: { left: '12%', top: '78%', animationDelay: '-2s' } })),
        h('div', { className: 'sc-orbit', onClick: (e) => { e.stopPropagation(); onOutside(); }, role: 'button', tabIndex: 0, title: '进入适配器星环' },
          h('span', { className: 'hint' }, '点这里出去 · 适配器星环')),
        h('button', { className: 'sc-core', onClick: onInside, title: '进入内核' },
          h('div', { className: 'sc-core-name' }, '内核'),
          h('div', { className: 'sc-core-en' }, 'KERNEL'),
          h('div', { className: 'sc-core-toggle' }, `T+${tick}s · 点击进入`)),
        h('div', { className: 'sc-hint' }, '中心 = 内核内部 · 外环 = 适配器星环'),
      );
    }

    /* ┢�┢� 内层：中央圆�?+ 左右两列菜单（Endfield �?HUD�?┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function KernelDeck(props) {
      const { onOpenGroup } = props;
      const [broken, setBroken] = useState(null);
      const left = GROUPS.slice(0, 2);
      const right = GROUPS.slice(2);

      /* 布局自检：容器高度为 0 时直接报红框，不是空屏 */
      useEffect(() => {
        const timer = setTimeout(() => {
          const el = document.querySelector('.sc-holo');
          if (!el) { setBroken('没找到 .sc-holo 容器'); return; }
          const box = el.getBoundingClientRect();
          if (box.height < 120 || box.width < 120) {
            setBroken('容器尺寸异常：' + Math.round(box.width) + '×' + Math.round(box.height));
          }
        }, 350);
        return () => clearTimeout(timer);
      }, []);

      const countOf = (group) => group.blocks.reduce((n, id) => n + capOf(id).length, 0);
      const menu = (group, side, i) => {
        const solo = group.id === 'other';
        return h('button', {
          key: group.id,
          className: 'sc-menu sc-group' + (solo ? ' solo' : ''),
          style: { '--rd': (0.08 + i * 0.08).toFixed(2) + 's' },
          onClick: () => onOpenGroup(group.id),
          title: solo ? '' : group.note,
        },
          h('span', { className: 'nm' }, group.name),
          solo ? null : h('span', { className: 'g-sub' }, group.note),
          solo ? null : h('span', { className: 'ct' }, countOf(group) + ' 项'),
          h('span', { className: 'tick' }),
          h('span', { className: 'bar' }));
      };

      if (broken) {
        return h('div', { className: 'sc-holo' },
          h('div', {
            style: {
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
              padding: '18px 22px', border: '1px solid rgba(248,113,113,.6)', borderRadius: 10,
              background: 'rgba(30,8,12,.85)', color: '#fecaca', fontSize: 13, lineHeight: 1.7, maxWidth: 520,
            },
          },
            h('div', { style: { fontWeight: 700, letterSpacing: '.14em', marginBottom: 6 } }, '内核界面布局异常'),
            h('div', null, broken),
            h('div', { style: { marginTop: 8, color: '#fca5a5', fontSize: 11 } }, '把这句话发给开发即可定位（不是你的操作问题）')));
      }

      return h('div', { className: 'sc-holo' },
        h('div', { className: 'sc-holo-glow' }),
        h('div', { className: 'sc-layout' },
          h('div', { className: 'sc-col left' }, left.map((g, i) => menu(g, 'left', i))),
          h('div', { className: 'sc-center' },
            h('div', { className: 'sc-disc' },
              h('div', { className: 'sc-disc-rings' }),
              h('div', { className: 'sc-disc-grid' }),
              h('div', { className: 'sc-sweep' }),
              h('svg', { className: 'sc-disc-svg', viewBox: '0 0 360 360', style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } },
                h('g', { opacity: '.7' }, Array.from({ length: 72 }, (_, i) => {
                  const ang = (i / 72) * Math.PI * 2;
                  const r1 = 168;
                  const r2 = i % 6 === 0 ? 176 : 172;
                  return h('line', {
                    key: 'tk' + i,
                    x1: 180 + Math.cos(ang) * r1, y1: 180 + Math.sin(ang) * r1,
                    x2: 180 + Math.cos(ang) * r2, y2: 180 + Math.sin(ang) * r2,
                    stroke: i % 6 === 0 ? 'rgba(198,240,255,.8)' : 'rgba(125,211,252,.4)',
                    strokeWidth: i % 6 === 0 ? 1.6 : 0.8,
                  });
                })),
                h('circle', { cx: 180, cy: 180, r: 148, fill: 'none', stroke: 'rgba(147,225,255,.35)', strokeWidth: 1, strokeDasharray: '2 6' }),
                h('circle', { cx: 180, cy: 180, r: 96, fill: 'none', stroke: 'rgba(147,225,255,.22)', strokeWidth: 1 })),
              h('div', { className: 'sc-disc-core' },
                h('div', { className: 'a' }, '内核'),
                h('div', { className: 'b2' }, 'KERNEL')))),
          h('div', { className: 'sc-col right' }, right.map((g, i) => menu(g, 'right', i)))),
        h('div', { className: 'sc-holo-tip' }, '四个入口 · 意识 / 记忆 / 感官 / 其他 · 点一项进入 · 右键返回'),
      );
    }

    /* ┢�┢� 记忆页：使用说明 / 读取方式 / 叙事双卡 / 向量索引 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    /* ───────────────────────────────────────────────────────────────
     * 记忆页（UI v0.26）
     * 数据只从同源 /surfcore-api/memory 读（FRONTEND-HANDOFF §4 契约 v1）。
     * 分层：memRequest/memApi（API）→ useMemoryLoad/Action/Job（Hooks）
     *       → MemoryPage 与各面板（组件）。不 import 内核、不读 state 文件。
     * 构建快照只做「非实时」参考，绝不冒充后端状态。
     * ─────────────────────────────────────────────────────────────── */

    const MEM_API_BASE = '/surfcore-api/memory';

    const memErr = (code, message, hint, extra) => Object.assign({ code, message, hint, retryable: false }, extra || {});
    const MEM_NOT_WIRED = /(not-wired|not-mounted|not-implemented)$/;

    const memPad2 = (n) => String(n).padStart(2, '0');
    const fmtClock = (at) => {
      const n = Number(at);
      if (!Number.isFinite(n) || !n) return '';
      const d = new Date(n);
      return memPad2(d.getHours()) + ':' + memPad2(d.getMinutes()) + ':' + memPad2(d.getSeconds());
    };
    const fmtMemAt = (at) => {
      const n = Number(at);
      if (!Number.isFinite(n) || !n) return '时间未知';
      try { return new Date(n).toLocaleString('zh-CN', { hour12: false }); } catch (error) { return String(at); }
    };
    const memModeLabel = (mode) => (mode === 'vector' ? '向量记忆' : mode === 'narrative' ? '叙事记忆' : '未知');
    const memSame = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? a === b : String(a) === String(b));
    const memActor = (actor) => {
      if (!actor) return '';
      if (typeof actor === 'string') return actor;
      if (typeof actor === 'object') return String(actor.name || actor.id || actor.qq || '');
      return String(actor);
    };
    const fmtBytes = (bytes) => {
      const n = Number(bytes) || 0;
      if (n <= 0) return '—';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = n;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
      return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 0 : 1)) + ' ' + units[i];
    };

    /* ── 记忆空间：纯投影数学（可单测；不依赖 DOM） ─────────────────── */
    const MEM_SPACE_LIMIT = 800;
    const memClamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    const memSpaceColor = (importance) => {
      const t = memClamp((Number(importance) || 0) / 100, 0, 1);
      const r = Math.round(56 + (251 - 56) * t);
      const g = Math.round(189 + (191 - 189) * t);
      const b = Math.round(248 + (36 - 248) * t);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    };
    function memSpaceProject(point, cam, width, height) {
      const x = Number(point && point.x) || 0;
      const y = Number(point && point.y) || 0;
      const z = Number(point && point.z) || 0;
      const yaw = Number(cam && cam.yaw) || 0;
      const pitch = Number(cam && cam.pitch) || 0;
      const zoom = Math.max(0.2, Number(cam && cam.zoom) || 1);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      let X = x * cy - z * sy;
      let Z = x * sy + z * cy;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const Y = y * cp - Z * sp;
      Z = y * sp + Z * cp;
      const focal = 2.6;
      const persp = focal / (focal + Z);
      const base = Math.min(width, height) * 0.38 * zoom;
      return {
        sx: width / 2 + X * base * persp,
        sy: height / 2 - Y * base * persp,
        depth: Z,
        scale: persp,
      };
    }
    function memSpaceLayout(points, cam, width, height) {
      const list = Array.isArray(points) ? points : [];
      return list.map((point) => Object.assign({ point }, memSpaceProject(point, cam, width, height)))
        .sort((a, b) => b.depth - a.depth);   // 远的先画，近的后画
    }

    const MEM_MODEL_STATUS = { installed: '已安装', 'not-installed': '未安装', running: '运行中' };
    const MEM_PROVIDER_STATUS = { ready: '就绪', 'no-index': '已配置 · 未建索引', unconfigured: '未配置', error: '错误', unknown: '状态未知' };
    const MEM_GROUP_LABEL = { basic: '基础', advanced: '进阶', experiment: '实验' };
    const MEM_PROVIDER_TABS = [
      { id: 'siliconflow', name: '硅基流动', ids: ['siliconflow'], names: ['硅基流动'] },
      { id: 'zhipu', name: '智谱', ids: ['zhipu'], names: ['智谱'] },
      { id: 'dashscope', name: '百炼', ids: ['dashscope', 'alibaba', 'bailian'], names: ['百炼', '阿里云'] },
      { id: 'openai', name: 'OpenAI', ids: ['openai'], names: ['openai'] },
    ];
    const MEM_JOB_RUNNING = ['running', 'queued', 'pending', 'starting', 'downloading', 'extracting', 'verifying'];

    /* ── API 层：唯一出口，统一信封/超时/取消/错误归一 ───────────────── */
    async function memRequest(path, options) {
      const opt = options || {};
      const method = opt.method || 'GET';
      const timeoutMs = Number(opt.timeoutMs) || 12000;
      if (typeof fetch !== 'function') {
        return { ok: false, error: memErr('ui.no-fetch', '当前环境没有 fetch，读不了记忆接口', '在 DSH Web 面板里打开；不要用构建快照当数据', { retryable: false }) };
      }
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { if (ctrl) ctrl.abort(); } catch (error) { /* 已中止 */ }
      }, timeoutMs);
      const outer = opt.signal;
      const relay = () => { try { if (ctrl) ctrl.abort(); } catch (error) { /* 已中止 */ } };
      if (outer) {
        if (outer.aborted) relay();
        else if (typeof outer.addEventListener === 'function') outer.addEventListener('abort', relay);
      }
      let res = null;
      let netErr = null;
      try {
        res = await fetch(MEM_API_BASE + path, {
          method,
          credentials: 'same-origin',
          headers: opt.form || opt.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: opt.form ? opt.form : (opt.body === undefined ? undefined : JSON.stringify(opt.body)),
          signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (error) {
        netErr = error;
      }
      clearTimeout(timer);
      if (outer && typeof outer.removeEventListener === 'function') outer.removeEventListener('abort', relay);

      if (netErr) {
        if (outer && outer.aborted) return { ok: false, aborted: true, error: memErr('ui.aborted', '请求已取消', '', { retryable: true }) };
        if (timedOut) return { ok: false, error: memErr('ui.timeout', '请求超时（' + Math.round(timeoutMs / 1000) + 's）', '后端可能没响应；稍后重试', { retryable: true, unknown: true }) };
        return { ok: false, error: memErr('ui.network', '连不上记忆接口', '确认 DSH Host 与 surfcore 后端在线，然后重试', { retryable: true, unknown: true }) };
      }

      let text = '';
      try { text = await res.text(); } catch (error) { text = ''; }
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = null; }

      if (!payload || typeof payload !== 'object') {
        const missing = res.status === 404 || res.status === 501;
        return {
          ok: false,
          status: res.status,
          error: memErr(
            missing ? 'memory.api-not-mounted' : 'memory.api-not-json',
            missing ? '记忆接口还没挂载（HTTP ' + res.status + '）' : '接口返回的不是 JSON（HTTP ' + res.status + '）',
            missing ? '后端按 FRONTEND-HANDOFF §4 挂 /surfcore-api/memory 后重试' : '路由可能没挂载、被页面兜底或被代理改写了；确认 API 路径后重试',
            { retryable: true, notWired: true, unknown: false },
          ),
        };
      }
      if (payload.ok === true) {
        const data = payload.data !== undefined ? payload.data : null;
        return { ok: true, status: res.status, data, raw: data === null ? payload : null };
      }
      const e = payload.error && typeof payload.error === 'object' ? payload.error : {};
      const code = String(e.code || ('http.' + res.status));
      const notWired = res.status === 501 || MEM_NOT_WIRED.test(code);
      return {
        ok: false,
        status: res.status,
        error: {
          code,
          message: String(e.message || ('接口失败（HTTP ' + res.status + '）')),
          hint: String(e.hint || '稍后重试；持续失败请把 code 反馈给后端'),
          retryable: e.retryable === true,
          notWired,
          unknown: false,
        },
      };
    }

    const memApi = {
      overview: (signal) => memRequest('/overview', { signal }),
      settings: (signal) => memRequest('/settings', { signal }),
      narrative: (query, signal) => {
        const q = query || {};
        const parts = ['tab=' + encodeURIComponent(q.tab || 'decay'), 'limit=' + encodeURIComponent(String(q.limit || 50))];
        if (q.q) parts.push('q=' + encodeURIComponent(q.q));
        if (q.cursor) parts.push('cursor=' + encodeURIComponent(q.cursor));
        return memRequest('/narrative?' + parts.join('&'), { signal });
      },
      library: (query, signal) => {
        const q = query || {};
        const parts = ['limit=' + encodeURIComponent(String(q.limit || 20))];
        if (q.q) parts.push('q=' + encodeURIComponent(q.q));
        if (q.cursor) parts.push('cursor=' + encodeURIComponent(q.cursor));
        return memRequest('/library?' + parts.join('&'), { signal });
      },
      vectorSpace: (query, signal) => {
        const q = query || {};
        if (!q.modelSpace) {
          return Promise.resolve({
            ok: false,
            error: memErr('ui.invalid-input', '没有选择模型空间', '先选一个已建索引的模型，再点「查看空间」', { retryable: false }),
          });
        }
        const parts = [
          'modelSpace=' + encodeURIComponent(String(q.modelSpace)),
          'limit=' + encodeURIComponent(String(q.limit || 800)),
        ];
        return memRequest('/vector/space?' + parts.join('&'), { signal });
      },
      vectorStatus: (signal) => memRequest('/vector/status', { signal }),
      vectorModels: (signal) => memRequest('/vector/models', { signal }),
      setMode: (mode) => memRequest('/mode', { method: 'POST', body: { mode } }),
      setVectorConfig: (config) => memRequest('/vector/config', { method: 'POST', body: config }),
      maintain: (limit) => memRequest('/vector/maintain', { method: 'POST', body: { limit } }),
      rebuild: (target) => memRequest('/vector/rebuild', {
        method: 'POST',
        body: Array.isArray(target) && target.length > 1 ? { modelSpaces: target } : { modelSpace: Array.isArray(target) ? target[0] : target },
      }),
      job: (id, signal) => memRequest('/jobs/' + encodeURIComponent(id), { signal }),
      importModel: (file, kind) => {
        if (typeof FormData !== 'function') {
          return Promise.resolve({ ok: false, error: memErr('ui.no-formdata', '当前环境不支持文件上传', '换浏览器或升级 DSH 后重试', { retryable: false }) });
        }
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        return memRequest('/models/import', { method: 'POST', form, timeoutMs: 120000 });
      },
      enableRuntime: (enabled) => memRequest('/runtime/enable', { method: 'POST', body: { enabled } }),
      saveProvider: (id, config) => memRequest('/providers/' + encodeURIComponent(id) + '/config', { method: 'POST', body: config }),
      testProvider: (id) => memRequest('/providers/' + encodeURIComponent(id) + '/test', { method: 'POST', body: {}, timeoutMs: 30000 }),
    };

    function memJobError(raw) {
      if (typeof raw === 'string' && raw) return memErr('memory.job-failed', raw, '看后端日志；点刷新确认当前状态', { retryable: false });
      if (raw && typeof raw === 'object') {
        return {
          code: String(raw.code || 'memory.job-failed'),
          message: String(raw.message || '任务失败'),
          hint: String(raw.hint || '点刷新确认当前状态'),
          retryable: raw.retryable === true,
        };
      }
      return memErr('memory.job-failed', '任务失败（后端没给原因）', '看后端日志；点刷新确认当前状态', { retryable: false });
    }

    /* ── Hooks：读取 / 动作 / job 轮询 ───────────────────────────────── */
    function useMemoryLoad(load, deps, options) {
      const opt = options || {};
      const enabled = opt.enabled !== false;
      const [state, setState] = useState({ phase: enabled ? 'loading' : 'idle', data: null, error: null, at: 0 });
      const loadRef = useRef(load);
      loadRef.current = load;
      const dataRef = useRef(state.data);
      dataRef.current = state.data;
      const genRef = useRef(0);
      const abortRef = useRef(null);
      const aliveRef = useRef(true);
      const busyRef = useRef(false);

      useEffect(() => () => {
        aliveRef.current = false;
        genRef.current += 1;
        if (abortRef.current) { try { abortRef.current.abort(); } catch (error) { /* 已中止 */ } }
      }, []);

      const execute = (cursor, append) => {
        if (!enabled) return Promise.resolve(null);
        if (busyRef.current) return Promise.resolve(null);
        busyRef.current = true;
        const gen = genRef.current + 1;
        genRef.current = gen;
        if (abortRef.current) { try { abortRef.current.abort(); } catch (error) { /* 已中止 */ } }
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = ctrl;
        setState((prev) => ({ phase: append && prev.data ? 'loading-more' : 'loading', data: prev.data, error: null, at: prev.at }));
        const finish = (res) => {
          if (!aliveRef.current || gen !== genRef.current) return res;
          busyRef.current = false;
          if (!res || res.aborted) return res;
          if (res.ok) {
            setState((prev) => {
              const incoming = res.data;
              const merged = cursor && prev.data && Array.isArray(prev.data.items) && incoming && Array.isArray(incoming.items)
                ? Object.assign({}, incoming, { items: prev.data.items.concat(incoming.items) })
                : incoming;
              const count = merged && Array.isArray(merged.items) ? merged.items.length : (merged ? 1 : 0);
              return { phase: count ? 'ready' : 'empty', data: merged || null, error: null, at: Date.now() };
            });
          } else {
            const err = res.error || memErr('ui.unknown', '读取失败', '重试；持续失败请反馈', { retryable: true });
            const phase = err.notWired ? 'unavailable' : (err.unknown ? 'unknown' : 'failed');
            setState((prev) => ({ phase, data: prev.data, error: err, at: Date.now() }));
          }
          return res;
        };
        return Promise.resolve(loadRef.current(ctrl ? ctrl.signal : null, cursor || null)).then(finish, (error) => finish({
          ok: false,
          error: memErr('ui.loader-exception', String((error && error.message) || error || '读取异常'), '重试；持续失败请反馈', { retryable: true }),
        }));
      };

      useEffect(() => {
        if (!enabled) {
          setState({ phase: 'idle', data: null, error: null, at: 0 });
          return undefined;
        }
        execute(null);
        return () => {
          genRef.current += 1;
          busyRef.current = false;
          if (abortRef.current) { try { abortRef.current.abort(); } catch (error) { /* 已中止 */ } }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [enabled].concat(deps));

      return {
        phase: state.phase,
        data: state.data,
        error: state.error,
        at: state.at,
        reload: () => execute(null),
        loadMore: () => {
          const cursor = dataRef.current && dataRef.current.nextCursor;
          if (!cursor) return Promise.resolve(null);
          return execute(cursor, true);
        },
      };
    }

    function useMemoryAction() {
      const [state, setState] = useState({ phase: 'idle', error: null, label: '', at: 0, data: null, raw: null });
      const aliveRef = useRef(true);
      const busyRef = useRef(false);
      useEffect(() => () => { aliveRef.current = false; }, []);

      const run = (label, fn) => {
        if (busyRef.current) return Promise.resolve(null);
        busyRef.current = true;
        setState({ phase: 'submitting', error: null, label: label || '', at: Date.now(), data: null, raw: null });
        let task;
        try {
          task = Promise.resolve(fn());
        } catch (error) {
          task = Promise.resolve({ ok: false, error: memErr('ui.action-exception', String((error && error.message) || error), '重试；持续失败请反馈', { retryable: true }) });
        }
        return task.then((res) => {
          busyRef.current = false;
          if (!aliveRef.current) return res;
          if (!res) {
            setState({ phase: 'failed', error: memErr('ui.empty-result', '动作没有返回结果', '重试；持续失败请反馈', { retryable: true }), label: label || '', at: Date.now(), data: null, raw: null });
            return res;
          }
          if (res.ok) {
            setState({ phase: 'success', error: null, label: label || '', at: Date.now(), data: res.data || null, raw: res.raw || null });
            return res;
          }
          if (res.aborted) {
            setState({ phase: 'idle', error: null, label: '', at: 0, data: null, raw: null });
            return res;
          }
          const err = res.error || memErr('ui.unknown', '动作失败', '重试；持续失败请反馈', { retryable: true });
          setState({ phase: err.unknown ? 'unknown' : 'failed', error: err, label: label || '', at: Date.now(), data: null, raw: null });
          return res;
        }, (error) => {
          busyRef.current = false;
          if (!aliveRef.current) return null;
          setState({ phase: 'failed', error: memErr('ui.action-exception', String((error && error.message) || error), '重试；持续失败请反馈', { retryable: true }), label: label || '', at: Date.now(), data: null, raw: null });
          return null;
        });
      };

      return {
        phase: state.phase,
        error: state.error,
        label: state.label,
        at: state.at,
        data: state.data,
        raw: state.raw,
        busy: state.phase === 'submitting',
        run,
        reset: () => { if (!busyRef.current) setState({ phase: 'idle', error: null, label: '', at: 0, data: null, raw: null }); },
      };
    }

    function useMemoryJob(jobId, onSettled, api) {
      const [state, setState] = useState({ phase: jobId ? 'running' : 'idle', job: null, error: null, at: 0 });
      const settledRef = useRef(onSettled);
      settledRef.current = onSettled;
      const apiRef = useRef(api || memApi);
      apiRef.current = api || memApi;

      useEffect(() => {
        if (!jobId) {
          setState({ phase: 'idle', job: null, error: null, at: 0 });
          return undefined;
        }
        let stopped = false;
        let timer = 0;
        let failures = 0;
        setState({ phase: 'running', job: null, error: null, at: Date.now() });
        const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
        const schedule = (ms) => { clear(); if (stopped) return; timer = setTimeout(tick, ms); };
        const fail = (error) => {
          failures += 1;
          if (failures >= 4) {
            setState({
              phase: 'unknown',
              job: null,
              error: error || memErr('ui.job-unknown', '连续多次读不到任务状态', '点刷新状态确认；任务可能仍在后端运行', { retryable: true, unknown: true }),
              at: Date.now(),
            });
            return;
          }
          schedule(Math.min(8000, 1200 + failures * 1800));
        };
        function tick() {
          if (stopped) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          apiRef.current.job(jobId).then((res) => {
            if (stopped) return;
            if (res && res.ok) {
              failures = 0;
              const job = res.data || {};
              const st = String(job.state || '').toLowerCase();
              if (st === 'done' || st === 'success') {
                setState({ phase: 'done', job, error: null, at: Date.now() });
                if (settledRef.current) settledRef.current('done', job);
                return;
              }
              if (st === 'failed' || st === 'error' || st === 'cancelled' || st === 'canceled') {
                setState({ phase: 'failed', job, error: memJobError(job.error), at: Date.now() });
                if (settledRef.current) settledRef.current('failed', job);
                return;
              }
              if (MEM_JOB_RUNNING.indexOf(st) < 0) {
                // 旧 job 实现用 error/其它状态；认不出的状态不能当 running 一直轮询
                setState({
                  phase: 'unknown',
                  job,
                  error: memErr('memory.job-state-unknown', '后端返回了未知任务状态：' + (st || '（空）'), '点刷新状态确认；任务可能仍在后端运行', { retryable: true, unknown: true }),
                  at: Date.now(),
                });
                return;
              }
              setState({ phase: 'running', job, error: null, at: Date.now() });
              schedule(2000);
              return;
            }
            if (res && res.error && res.error.notWired) {
              setState({ phase: 'unavailable', job: null, error: res.error, at: Date.now() });
              return;
            }
            fail(res && res.error);
          }, (error) => {
            if (stopped) return;
            fail(memErr('ui.job-network', String((error && error.message) || error || '轮询失败'), '检查后端后刷新状态', { retryable: true, unknown: true }));
          });
        }
        const onVis = () => {
          if (stopped) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { clear(); return; }
          schedule(300);
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVis);
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') schedule(500);
        return () => {
          stopped = true;
          clear();
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVis);
        };
      }, [jobId]);

      return state;
    }

    /* 语音安装/导入进度：只在有活动任务且页面可见时轮询；无 setInterval。 */
    function useVoicePoll(active, reload) {
      const reloadRef = useRef(reload);
      reloadRef.current = reload;
      useEffect(() => {
        if (!active) return undefined;
        let stopped = false;
        let timer = null;
        let failures = 0;
        const schedule = (ms) => {
          if (stopped) return;
          timer = setTimeout(tick, ms);
        };
        function tick() {
          if (stopped) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            schedule(2000);
            return;
          }
          Promise.resolve(reloadRef.current()).then(() => { failures = 0; }, () => { failures += 1; }).then(() => {
            if (!stopped) schedule(Math.min(8000, 2000 + failures * 1200));
          });
        }
        const onVis = () => {
          if (stopped) return;
          if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
            try { reloadRef.current(); } catch (error) { /* 忽略 */ }
          }
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVis);
        schedule(1500);
        return () => {
          stopped = true;
          if (timer) clearTimeout(timer);
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVis);
        };
      }, [active]);
    }

    /* ── 通用小件 ─────────────────────────────────────────────────── */
    function MemSource(props) {
      const phase = props.phase || 'loading';
      const tone = phase === 'ready' || phase === 'empty' ? 'ok'
        : phase === 'unavailable' ? 'off'
          : (phase === 'unknown' || phase === 'failed') ? 'warn' : '';
      const label = phase === 'ready' ? '实时接口'
        : phase === 'empty' ? '实时接口（空）'
          : phase === 'unavailable' ? '后端待接入'
            : phase === 'unknown' ? '状态未知'
              : phase === 'failed' ? '读取失败' : '读取中';
      const time = (phase === 'ready' || phase === 'empty') && props.at ? ' · ' + fmtClock(props.at) : '';
      return h('span', {
        className: 'sc-mem-source' + (tone ? ' ' + tone : ''),
        title: props.note ? '数据来源：' + props.note : '数据来源：/surfcore-api/memory',
      }, h('i'), label + time);
    }

    function MemErrorBlock(props) {
      const phase = props.phase || 'failed';
      const e = props.error || {};
      const title = phase === 'unavailable' ? '后端待接入'
        : phase === 'unknown' ? '状态未知'
          : phase === 'empty' ? '没有数据' : '请求失败';
      const cls = phase === 'unavailable' || phase === 'empty' ? 'off' : phase === 'unknown' ? 'unknown' : 'err';
      return h('div', { className: 'sc-mem-state ' + cls + (props.compact ? ' compact' : '') },
        h('div', { className: 'ttl' }, title),
        h('div', { className: 'msg' }, e.message || (phase === 'empty' ? '接口成功，但没返回数据。' : '没有拿到错误详情')),
        h('div', { className: 'meta' },
          e.code ? h('code', null, e.code) : null,
          e.hint ? h('span', null, e.hint) : null),
        props.onRetry ? h('button', { className: 'sc-btn ghost', onClick: props.onRetry }, props.retryLabel || (phase === 'unavailable' ? '重试接入' : '重试')) : null);
    }

    function MemLoading(props) {
      return h('div', { className: 'sc-mem-state loading' }, h('span', { className: 'sc-spin' }), (props && props.label) || '正在读取…');
    }

    function MemEmpty(props) {
      return h('div', { className: 'sc-mem-empty' }, props.children);
    }

    function MemPill(props) {
      return h('span', { className: 'sc-mem-pill' + (props.tone ? ' ' + props.tone : '') }, props.children);
    }

    function MemJobBar(props) {
      const state = props.state || { phase: 'idle' };
      if (!state || state.phase === 'idle') return null;
      const label = props.label || '任务';
      if (state.phase === 'running') {
        const job = state.job || {};
        const total = Number(job.total) || 0;
        const done = Number(job.progress) || 0;
        // 后端 mem job 只在完成时把 progress 置 100；0 不能画成 0% 的“卡住”
        const reported = total > 0 && done > 0;
        const pct = reported ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : null;
        return h('div', { className: 'sc-mem-job' },
          h('div', { className: 'hd' }, h('b', null, label + ' · 运行中'), h('span', null, reported ? done + ' / ' + total : '进度未知（后端未上报）')),
          h('div', { className: 'bar' }, h('i', { style: pct === null ? { width: '38%', animation: 'sc-job-slide 1.4s ease-in-out infinite alternate' } : { width: pct + '%' } })),
          h('div', { className: 'ft' }, job.jobId ? h('code', null, String(job.jobId)) : '接口：GET /surfcore-api/memory/jobs/:id'));
      }
      if (state.phase === 'done') {
        return h('div', { className: 'sc-mem-job done' },
          h('div', { className: 'hd' }, h('b', null, label + ' · 完成'), h('span', null, fmtClock(state.at))),
          h('div', { className: 'ft' }, '后端 /jobs/:id 返回 done；相关状态已重新读取'));
      }
      const phase = state.phase === 'unavailable' ? 'unavailable' : state.phase === 'unknown' ? 'unknown' : 'failed';
      return h(MemErrorBlock, { phase, error: state.error, compact: true, retryLabel: '刷新状态', onRetry: props.onRetry });
    }

    /* ── 使用说明：向量记忆 / 叙事记忆 ─────────────────────────────── */
    function MemoryGuidePage(props) {
      const onBack = typeof props.onBack === 'function' ? props.onBack : () => {};
      const [tab, setTab] = useState('vector');
      const red = { color: '#ff6b6b', fontWeight: 700, lineHeight: 1.8 };
      const redBox = {
        color: '#ff6b6b',
        fontWeight: 700,
        lineHeight: 1.8,
        padding: '10px 12px',
        border: '1px solid rgba(255,107,107,.7)',
        borderRadius: 8,
        background: 'rgba(255,107,107,.08)',
        marginTop: 10,
      };
      return h('div', {
        className: 'sc-page sc-guide',
        onContextMenu: (e) => { e.stopPropagation(); onBack(); },
      },
        h('div', { className: 'top' },
          h('h2', null, '使用说明'),
          h('span', { className: 'en' }, 'GUIDE'),
          h('span', { className: 'sc-badge' }, tab === 'vector' ? '向量记忆' : '叙事记忆')),
        h('div', { className: 'note' }, '先看向量记忆；叙事记忆只保留到 1.0.0，之后下线。'),
        h('div', { className: 'sc-mem-tabs' },
          h('button', { className: 'sc-mem-tab' + (tab === 'vector' ? ' on' : ''), onClick: () => setTab('vector') }, '向量记忆'),
          h('button', { className: 'sc-mem-tab' + (tab === 'narrative' ? ' on' : ''), onClick: () => setTab('narrative') }, '叙事记忆')),

        tab === 'vector' ? h('div', null,
          h('div', { className: 'sc-mem-card' },
            h('h4', null, '向量记忆是什么'),
            h('div', { style: { lineHeight: 1.8, fontSize: 12 } },
              h('p', null, '把每条记忆按“意思”存成一组语义坐标。以后用一句话去找，不要求关键词和原文完全一样。'),
              h('p', null, '它和叙事记忆同时保存、互不冲突；切换「记忆读取方式」只改读取/注入，不会停止任何一边的存储。')),
            h('h4', { style: { marginTop: 14 } }, '为什么推荐向量记忆'),
            h('ul', { style: { margin: '4px 0 0 18px', lineHeight: 1.8, fontSize: 12 } },
              h('li', null, '记忆多、时间久也能按语义捞出细节，不靠关键词硬碰。'),
              h('li', null, '“我记得你说过类似的话”这类模糊回忆，向量明显更强。'),
              h('li', null, '叙事记忆是整理好的日记摘要，稳定好读，但召回能力远远不如向量记忆。')),
            h('h4', { style: { marginTop: 14 } }, '怎么开始'),
            h('ol', { style: { margin: '4px 0 0 18px', lineHeight: 1.8, fontSize: 12 } },
              h('li', null, '到下面「Embedding 功能」配置本地模型或云端服务商。'),
              h('li', null, '本地模型一定先导入 runtime，再导入模型；没有 runtime，模型包导入了也不会工作。'),
              h('li', null, '等状态显示已索引；新记忆会先标“待编码”，后台自动补，不用手点。'),
              h('li', null, '把顶部「记忆读取方式」切到「向量记忆」。')),
            h('div', { style: redBox }, '【必看安装顺序】本地模型：先导入 runtime，再导入模型。否则模型无法加载。'),
            h('h4', { style: { marginTop: 14 } }, '「立即整理」和「重建索引」'),
            h('div', { style: { lineHeight: 1.8, fontSize: 12 } },
              h('p', null, '「立即整理」只编码还没索引的新记忆，便宜、日常用这个。'),
              h('p', null, '「重建索引」把当前模型下全部记忆重算一遍，很慢；只在换模型、索引损坏或索引丢失时用。'),
              h('p', null, '每个模型有自己的一套索引；「为多个模型重建索引」只在确实需要多个模型时点。')),
            h('h4', { style: { marginTop: 14 } }, '注意'),
            h('ul', { style: { margin: '4px 0 0 18px', lineHeight: 1.8, fontSize: 12 } },
              h('li', null, '相似不等于事实，命中后仍要判断。'),
              h('li', null, '敏感记录不会显示，也不会被注入。'),
              h('li', null, '没有索引就只能看条数，不能找相似旧事。'))),

          h('div', { className: 'sc-mem-card' },
            h('h4', null, '云端服务商怎么选（旧版说明）'),
            h('div', { style: { lineHeight: 1.8, fontSize: 12 } },
              h('p', null, '云端适合不想在本机跑模型的人；需要支持 embeddings 的服务商账号和 API Key，按量计费，记忆正文会发给服务商。'),
              h('ul', { style: { margin: '4px 0 0 18px' } },
                h('li', null, '硅基流动：最省事、不需要梯子。'),
                h('li', null, '智谱：便宜稳定。'),
                h('li', null, '阿里云百炼：大厂、有免费额度。'),
                h('li', null, 'OpenAI：需要梯子和海外支付，普通用户不优先。')),
              h('p', { className: 'hint' }, 'Key 通常只显示一次；创建后立刻粘贴到「云端模型」并保存，关掉控制台就看不到了。')))) :

          h('div', null,
            h('div', { className: 'sc-mem-card' },
              h('h4', null, '叙事记忆是什么'),
              h('div', { style: { lineHeight: 1.8, fontSize: 12 } },
                h('p', null, '两套卡：衰减卡（会忘、会模糊）+ 全量卡（只追加、不遗忘）。'),
                h('p', null, '它像整理好的日记摘要：稳定、好读，适合看最近发生了什么、关系怎么变。'))),
            h('div', { style: redBox },
              h('div', null, '⚠ 性能警告'),
              h('div', { style: { fontWeight: 400, marginTop: 4 } },
                '叙事记忆的召回能力远远不如向量记忆，只适合少量、近期、关键词明确的回忆。'),
              h('div', { style: { fontWeight: 400, marginTop: 6 } },
                '强烈建议现在就把「记忆读取方式」切到「向量记忆」，不要等下线前才迁。')),
            h('div', { className: 'sc-mem-card' },
              h('h4', null, '下线时间'),
              h('div', { style: redBox },
                '叙事记忆将在 SurfCore 1.0.0 版本正式下线。',
                h('div', { style: { fontWeight: 400, marginTop: 4 } },
                  '1.0.0 之后不再作为读取路径；现在切换不影响已有数据，叙事卡仍会继续写入到下线前。')),
              h('h4', { style: { marginTop: 14 } }, '现在要做什么'),
              h('ol', { style: { margin: '4px 0 0 18px', lineHeight: 1.8, fontSize: 12 } },
                h('li', null, '先确认向量记忆已配置、已建索引。'),
                h('li', null, '把「记忆读取方式」切到向量记忆。'),
                h('li', null, '观察一段时间；需要回退时再切回叙事记忆。'),
                h('li', null, '1.0.0 前完成迁移，不要把叙事记忆当长期方案。')),
              h('p', { className: 'hint' }, '切换只影响读取/注入，不会删除叙事卡，也不会停止向量写入。'))),

        h('button', { className: 'sc-backlink', onClick: onBack }, '← 返回记忆'));
    }

    /* ── 来源标签（UI 翻译 sourceId；颜色/符号都来自 source.js 映射） ── */
    function MemSourceTag(props) {
      const meta = sourceMeta(props.raw);
      return h('span', {
        className: 'sc-src',
        style: {
          color: meta.color,
          borderColor: meta.color + '66',
          background: meta.color + '18',
        },
        title: '来源：' + meta.label,
      }, h('i', { 'aria-hidden': true }, meta.glyph), meta.label);
    }

    /* ── 单条记忆（叙事列表与快照共用一个渲染，避免两处字段漂移） ───── */
    function MemRecordRow(props) {
      const r = props.record || {};
      const label = props.label || '';
      const rawSource = r.sourceId || r.platform || r.channel;
      return h('div', { className: 'sc-mem-item' },
        h('div', { className: 'txt' }, r.text || '（空文本）'),
        h('div', { className: 'meta' },
          h('span', null, fmtMemAt(r.at)),
          h(MemSourceTag, { raw: rawSource }),
          r.kind ? h('span', null, String(r.kind)) : null,
          memActor(r.actor) ? h('span', null, memActor(r.actor)) : null,
          r.score != null && Number.isFinite(Number(r.score)) ? h('span', { className: 'imp' }, '相似度 ' + Number(r.score).toFixed(3)) : null,
          r.importance != null ? h('span', { className: 'imp' }, '重要度 ' + String(r.importance)) : null,
          r.initial ? h('span', null, '最初') : null,
          r.pinned ? h('span', null, '置顶') : null,
          label ? h('span', null, label) : null));
    }

    /* ── 构建快照参考（只在接口不可用时出现，明确标注非实时） ───────── */
    function MemorySnapshotNote(props) {
      const M = props.M;
      const [open, setOpen] = useState(false);
      if (!M) return null;
      const built = M.builtAt ? String(M.builtAt).replace('T', ' ').slice(0, 16) : '构建时';
      const records = Array.isArray(M.records) ? M.records.slice(-8).reverse() : [];
      return h('div', { className: 'sc-mem-snapshot' },
        h('div', { className: 'hd' },
          h('b', null, '构建时快照 · 非实时'),
          h('span', null, '快照 ' + built),
          h('button', { className: 'sc-btn ghost', onClick: () => setOpen(!open) }, open ? '收起' : '查看快照'),
          props.onRetry ? h('button', { className: 'sc-btn ghost', onClick: props.onRetry }, '重试接口') : null),
        h('div', { className: 'hint' }, '只在接口没接上时出现：这是构建那一刻的状态，不能当实时数据，也不能据此点任何写按钮。'),
        open ? h('div', null,
          h('div', { className: 'sc-mem-status' },
            h('div', null, h('b', null, String((M.stats && M.stats.decay) || 0)), h('span', null, '衰减记录')),
            h('div', null, h('b', null, String((M.stats && M.stats.full) || 0)), h('span', null, '全量记录')),
            h('div', null, h('b', null, String((M.vector && M.vector.indexed) || 0)), h('span', null, '已索引')),
            h('div', null, h('b', null, String((M.vector && M.vector.pending) || 0)), h('span', null, '待编码')),
            h('div', null, h('b', null, String((M.vector && M.vector.failed) || 0)), h('span', null, '失败'))),
          h('div', { className: 'hint' }, '读取方式 ' + (M.mode === 'vector' ? '向量' : '叙事') + ' · 索引 ' + ((M.vector && M.vector.modelSpace) || (M.config && M.config.modelSpace) || 'default')),
          records.length
            ? h('div', { className: 'sc-mem-list' }, records.map((r, i) => h(MemRecordRow, {
              key: 'snap-' + i,
              record: r,
              label: '快照行',
            })))
            : h('div', { className: 'sc-mem-empty' }, '快照里没有记录。'))
          : null,
      );
    }

    /* ── 读取方式弹窗：只改读取，两套都存储 ─────────────────────────── */
    function MemoryModeDialog(props) {
      const api = props.api || memApi;
      const current = props.current || '';
      const controlAvailable = props.controlAvailable === true;
      const capabilities = (props.capabilities && typeof props.capabilities === 'object') ? props.capabilities : null;
      const allowed = controlAvailable && (!capabilities || capabilities.mode !== false);
      const onClose = typeof props.onClose === 'function' ? props.onClose : () => {};
      const onSaved = typeof props.onSaved === 'function' ? props.onSaved : () => {};
      const [draft, setDraft] = useState(current);
      const action = useMemoryAction();
      const busy = action.busy;
      const requestClose = () => { if (!busy) onClose(); };
      const save = () => {
        if (!allowed || busy || !draft || draft === current) return;
        action.run('保存读取方式', () => api.setMode(draft)).then((res) => {
          if (!res || !res.ok) return;
          const next = (res.data && res.data.mode) || (res.raw && res.raw.mode) || draft;
          onSaved(next);
        });
      };
      const opt = (value, title, desc) => h('div', {
        className: 'opt' + (draft === value ? ' on' : ''),
        onClick: () => { if (!busy) setDraft(value); },
      },
        h('input', { type: 'radio', checked: draft === value, readOnly: true }),
        h('div', null, h('div', { className: 'k' }, title), h('div', { className: 'd' }, desc)));
      return h('div', {
        className: 'sc-modal-mask',
        onContextMenu: (e) => e.stopPropagation(),
        onClick: requestClose,
      },
        h('div', { className: 'sc-modal', onClick: (e) => e.stopPropagation() },
          h('h3', null, '记忆读取方式'),
          h('div', { className: 'sub' }, '两套记忆都继续写入；切换只影响当前人格读取哪一套。当前：' + memModeLabel(current)),
          opt('narrative', '叙事记忆（衰减卡 + 全量卡）', '稳定、好读；适合最近发生了什么、关系怎么变。'),
          opt('vector', '向量记忆（按当前消息检索）', '按意思翻旧账；需要 embedding 服务与索引。'),
          !controlAvailable ? h('div', { className: 'sc-mem-banner warn' }, '后端待补充：overview.controlAvailable=false，保存禁用。')
            : (!allowed ? h('div', { className: 'sc-mem-banner warn' }, '后端未开启「记忆读取方式」动作（capabilities.mode=false），保存禁用。') : null),
          action.error ? h(MemErrorBlock, { phase: action.error.notWired ? 'unavailable' : (action.phase === 'unknown' ? 'unknown' : 'failed'), error: action.error, compact: true, onRetry: save }) : null,
          action.phase === 'unknown' ? h('div', { className: 'sc-mem-note' }, '超时/断线：无法确认是否已切换。可以重试，或关闭后点「刷新状态」核对。') : null,
          h('div', { className: 'actions' },
            h('button', { className: 'sc-btn ghost', onClick: requestClose, disabled: busy }, '取消'),
            h('button', { className: 'sc-btn', disabled: busy || !allowed || !draft || draft === current, onClick: save }, busy ? '保存中…' : '保存'))));
    }

    /* ── 叙事记忆：衰减卡 / 全量卡 ─────────────────────────────────── */
    function NarrativePane(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const [sub, setSub] = useState('decay');
      const [query, setQuery] = useState('');
      const [applied, setApplied] = useState('');
      useEffect(() => {
        const timer = setTimeout(() => setApplied(query.trim()), 320);
        return () => clearTimeout(timer);
      }, [query]);
      const list = useMemoryLoad((signal) => api.narrative({
        tab: sub,
        q: sub === 'full' ? applied : '',
        limit: 50,
      }, signal), [sub, applied]);
      const items = (list.data && Array.isArray(list.data.items)) ? list.data.items : [];
      const nextCursor = list.data && list.data.nextCursor ? String(list.data.nextCursor) : '';
      const stats = (overview && overview.stats) || null;
      const total = sub === 'decay' ? (stats ? stats.decay : null) : (stats ? stats.full : null);
      const hasData = !!list.data;
      const isErr = list.phase === 'failed' || list.phase === 'unknown' || list.phase === 'unavailable';
      const row = (r, i) => h(MemRecordRow, { key: r.id || ('n-' + (r.at || 0) + '-' + i), record: r });
      return h('div', null,
        h('div', { className: 'sc-mem-subtabs' },
          h('button', { className: 'sc-mem-sub' + (sub === 'decay' ? ' on' : ''), onClick: () => setSub('decay') }, '衰减记忆卡'),
          h('button', { className: 'sc-mem-sub' + (sub === 'full' ? ' on' : ''), onClick: () => setSub('full') }, '全量记忆卡')),
        h('div', { className: 'sc-mem-toolbar' },
          h('span', { className: 'sc-mem-count' }, total != null ? '后端统计 ' + total + ' 条' : '已载入 ' + items.length + ' 条'),
          h('span', { className: 'sc-spacer' }),
          h(MemSource, { phase: list.phase, at: list.at, note: 'GET /surfcore-api/memory/narrative' }),
          h('button', { className: 'sc-btn ghost', onClick: list.reload, disabled: list.phase === 'loading' || list.phase === 'loading-more' }, '刷新')),
        sub === 'full' ? h('div', { className: 'sc-mem-field', style: { maxWidth: 460 } },
          h('label', null, '按关键词找（q 交给后端过滤；不是语义检索）'),
          h('input', { value: query, onChange: (e) => setQuery(e.target.value), placeholder: '例如：第一次、难过、某个群友' }),
          applied ? h('div', { className: 'hint' }, '当前过滤词：' + applied) : null) : null,
        h('div', { className: 'sc-mem-card' },
          h('h4', null, (sub === 'decay' ? '衰减记忆卡' : '全量记忆卡') + ' · ' + items.length + (nextCursor ? '+' : '') + ' 条'),
          h('div', { className: 'hint' }, sub === 'decay'
            ? '衰减卡会随时间和容量变模糊；这里只显示后端返回的当前状态。'
            : '全量卡是只读档案，不参与日常提示词；关键词过滤在后端做。'),
          !hasData && (list.phase === 'loading' || list.phase === 'loading-more') ? h(MemLoading, { label: '正在读取记忆卡…' }) : null,
          !hasData && isErr ? h(MemErrorBlock, { phase: list.phase, error: list.error, onRetry: list.reload }) : null,
          !hasData && list.phase === 'empty' ? h(MemEmpty, null, sub === 'decay' ? '还没有衰减记忆。' : (applied ? '没有匹配的全量记忆。' : '全量卡里还没有记录。')) : null,
          hasData && isErr ? h(MemErrorBlock, { phase: list.phase, error: list.error, compact: true, onRetry: list.reload }) : null,
          hasData && !items.length && !isErr ? h(MemEmpty, null, sub === 'decay' ? '还没有衰减记忆。' : (applied ? '没有匹配的全量记忆。' : '全量卡里还没有记录。')) : null,
          items.length ? h('div', { className: 'sc-mem-list' }, items.map(row)) : null,
          nextCursor ? h('button', {
            className: 'sc-btn ghost',
            style: { marginTop: 10 },
            onClick: list.loadMore,
            disabled: list.phase === 'loading-more',
          }, list.phase === 'loading-more' ? '加载中…' : '加载更多') : null,
          items.length && !nextCursor ? h('div', { className: 'sc-mem-note' }, '已到最后一页（nextCursor=null）。') : null,
          h('div', { className: 'sc-mem-note' }, '接口：GET /narrative?tab=' + sub + '&limit=50' + (sub === 'full' && applied ? '&q=…' : '') + ' · 列表由后端按可见性过滤，UI 不自己猜隐私。')));
    }

    /* ── 记录检索：owner/admin 视图；最近记录 + 语义搜索（向量记忆子 tab） ─ */
    function LibraryPane(props) {
      const api = props.api || memApi;
      const can = typeof props.can === 'function' ? props.can : () => true;
      const enabled = props.enabled !== false && can('library');
      const disabledReason = String(props.disabledReason || '');
      const [query, setQuery] = useState('');
      const [applied, setApplied] = useState('');
      const list = useMemoryLoad((signal) => api.library({ q: applied, limit: 20 }, signal), [applied, enabled], { enabled });
      const items = (list.data && Array.isArray(list.data.items)) ? list.data.items : [];
      const nextCursor = list.data && list.data.nextCursor ? String(list.data.nextCursor) : '';
      const hasData = !!list.data;
      const isErr = list.phase === 'failed' || list.phase === 'unknown' || list.phase === 'unavailable';
      const submit = () => {
        if (!enabled) return;
        const next = query.trim();
        if (next === applied) list.reload();
        else setApplied(next);
      };
      const clear = () => {
        setQuery('');
        if (applied) setApplied('');
      };
      return h('div', null,
        h('div', { className: 'sc-mem-toolbar' },
          h(MemSource, { phase: list.phase, at: list.at, note: 'GET /surfcore-api/memory/library' }),
          h('span', { className: 'sc-spacer' }),
          h('button', { className: 'sc-btn ghost', onClick: list.reload, disabled: !enabled || list.phase === 'loading' }, '刷新')),
        h('div', { className: 'sc-mem-field', style: { maxWidth: 540 } },
          h('label', null, '按意思找记忆（q 交给后端做语义检索；清空 = 最近记录）'),
          h('div', { className: 'sc-mem-inline' },
            h('input', {
              value: query,
              disabled: !enabled,
              placeholder: '例如：第一次见面、难过、某个群友',
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } },
            }),
            h('button', { className: 'sc-btn', disabled: !enabled || list.phase === 'loading', onClick: submit }, list.phase === 'loading' ? '检索中…' : '搜索'),
            applied ? h('button', { className: 'sc-btn ghost', onClick: clear }, '清空') : null)),
        !enabled ? h('div', { className: 'sc-mem-banner warn' }, disabledReason || '记录检索当前不可用。') : null,
        h('div', { className: 'sc-mem-card' },
          h('h4', null, applied ? ('记录检索 · 搜索「' + applied + '」') : '记录检索 · 最近记录'),
          h('div', { className: 'hint' }, 'owner/admin 视图；敏感记录由后端过滤；语义搜索依赖向量索引/服务商，失败会显示 code/hint。'),
          !hasData && (list.phase === 'loading' || list.phase === 'loading-more') ? h(MemLoading, { label: '正在读取记录…' }) : null,
          !hasData && isErr ? h(MemErrorBlock, { phase: list.phase, error: list.error, onRetry: list.reload }) : null,
          !hasData && list.phase === 'empty' ? h(MemEmpty, null, applied ? '没有匹配的记忆。' : '向量记忆里还没有记录。') : null,
          hasData && isErr ? h(MemErrorBlock, { phase: list.phase, error: list.error, compact: true, onRetry: list.reload }) : null,
          hasData && !items.length && !isErr ? h(MemEmpty, null, applied ? '没有匹配的记忆。' : '向量记忆里还没有记录。') : null,
          items.length ? h('div', { className: 'sc-mem-list' }, items.map((r, i) => h(MemRecordRow, {
            key: r.id || ('lib-' + i),
            record: r,
          }))) : null,
          nextCursor ? h('button', {
            className: 'sc-btn ghost',
            style: { marginTop: 10 },
            onClick: list.loadMore,
            disabled: list.phase === 'loading-more',
          }, list.phase === 'loading-more' ? '加载中…' : '加载更多') : null,
          items.length && !nextCursor ? h('div', { className: 'sc-mem-note' }, '已到最后一页（nextCursor=null）。') : null,
          h('div', { className: 'sc-mem-note' }, '接口：GET /library?limit=20' + (applied ? '&q=…' : '') + ' · 只读；搜索用后端语义检索，不在前端拼规则。')));
    }

    /* ── 记忆空间：Canvas 3D 投影（只读、无外部依赖） ───────────────── */
    function MemorySpaceCanvas(props) {
      const result = props.result || {};
      const points = Array.isArray(result.points) ? result.points : [];
      const wrapRef = useRef(null);
      const canvasRef = useRef(null);
      const camRef = useRef({ yaw: -0.62, pitch: 0.42, zoom: 1 });
      const dragRef = useRef(null);
      const layoutRef = useRef([]);
      const drawRef = useRef(() => {});
      const [hover, setHover] = useState(null);
      const [picked, setPicked] = useState(null);

      const draw = () => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        if (w < 2 || h < 2) return;
        const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(3,9,18,.28)';
        ctx.fillRect(0, 0, w, h);

        const cam = camRef.current;
        const project = (x, y, z) => memSpaceProject({ x, y, z }, cam, w, h);
        const cube = [
          [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
          [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
        ].map((v) => project(v[0], v[1], v[2]));
        const edges = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(56,189,248,.14)';
        for (const edge of edges) {
          ctx.beginPath();
          ctx.moveTo(cube[edge[0]].sx, cube[edge[0]].sy);
          ctx.lineTo(cube[edge[1]].sx, cube[edge[1]].sy);
          ctx.stroke();
        }

        const origin = project(0, 0, 0);
        const axes = [
          { end: project(1, 0, 0), color: 'rgba(103,232,249,.65)', label: 'X' },
          { end: project(0, 1, 0), color: 'rgba(167,139,250,.65)', label: 'Y' },
          { end: project(0, 0, 1), color: 'rgba(251,191,36,.6)', label: 'Z' },
        ];
        ctx.font = '10px ui-monospace, monospace';
        for (const axis of axes) {
          ctx.beginPath();
          ctx.moveTo(origin.sx, origin.sy);
          ctx.lineTo(axis.end.sx, axis.end.sy);
          ctx.strokeStyle = axis.color;
          ctx.stroke();
          ctx.fillStyle = axis.color;
          ctx.fillText(axis.label, axis.end.sx + 4, axis.end.sy - 3);
        }

        const layout = memSpaceLayout(points, cam, w, h);
        layoutRef.current = layout;
        for (const item of layout) {
          const point = item.point;
          const isPicked = !!(picked && picked.point && picked.point.id === point.id);
          const isHover = !!(hover && hover.point && hover.point.id === point.id);
          const imp = memClamp((Number(point.importance) || 0) / 100, 0, 1);
          const radius = Math.max(1.4, (2 + imp * 2.6) * item.scale * (isPicked ? 1.9 : isHover ? 1.5 : 1));
          ctx.beginPath();
          ctx.arc(item.sx, item.sy, radius, 0, Math.PI * 2);
          ctx.fillStyle = memSpaceColor(point.importance);
          ctx.globalAlpha = isPicked || isHover ? 1 : 0.82;
          ctx.fill();
          ctx.globalAlpha = 1;
          if (isPicked || isHover) {
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, radius + 2.5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(224,242,254,.9)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      };
      drawRef.current = draw;

      useEffect(() => {
        setHover(null);
        setPicked(null);
      }, [result]);
      useEffect(() => { drawRef.current(); }, [result, hover, picked]);
      useEffect(() => {
        const onResize = () => drawRef.current();
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);
        let observer = null;
        try {
          if (typeof ResizeObserver === 'function' && wrapRef.current) {
            observer = new ResizeObserver(onResize);
            observer.observe(wrapRef.current);
          }
        } catch (error) { /* 忽略 */ }
        return () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('resize', onResize);
          if (observer) observer.disconnect();
        };
      }, []);
      useEffect(() => {
        const el = canvasRef.current;
        if (!el || typeof el.addEventListener !== 'function') return undefined;
        const onWheel = (event) => {
          event.preventDefault();
          camRef.current.zoom = memClamp(camRef.current.zoom * (event.deltaY < 0 ? 1.12 : 0.89), 0.45, 3);
          drawRef.current();
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, []);

      const pointAt = (event) => {
        const wrap = wrapRef.current;
        if (!wrap) return null;
        const rect = wrap.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        for (const item of layoutRef.current) {
          const distance = Math.hypot(item.sx - x, item.sy - y);
          if (distance <= 10 && (!best || distance < best.distance)) best = { item, distance };
        }
        return best ? best.item : null;
      };
      const onPointerDown = (event) => {
        const cam = camRef.current;
        setHover(null);
        dragRef.current = { x: event.clientX, y: event.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag) {
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          camRef.current.yaw = drag.yaw + dx * 0.008;
          camRef.current.pitch = memClamp(drag.pitch - dy * 0.008, -1.2, 1.2);
          drawRef.current();
          return;
        }
        const item = pointAt(event);
        if (!item) {
          if (hover) setHover(null);
          return;
        }
        if (!hover || !hover.point || hover.point.id !== item.point.id) setHover(item);
      };
      const onPointerUp = (event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
        if (drag && drag.moved) return;
        const item = pointAt(event);
        setPicked(item || null);
        setHover(null);
      };
      const onPointerLeave = () => {
        if (!dragRef.current) setHover(null);
      };
      const onPointerCancel = () => { dragRef.current = null; };

      const selected = picked && picked.point ? picked.point : null;
      return h('div', null,
        h('div', { className: 'sc-space-wrap', ref: wrapRef },
          h('canvas', {
            ref: canvasRef,
            className: 'sc-space-canvas',
            role: 'img',
            'aria-label': '记忆空间三维投影；拖拽旋转，滚轮缩放',
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel,
            onPointerLeave,
          }),
          hover ? h('div', { className: 'sc-space-tip', style: { left: hover.sx, top: hover.sy } },
            h('b', null, fmtMemAt(hover.point.at)),
            h(MemSourceTag, { raw: hover.point.sourceId || hover.point.platform || hover.point.channel }),
            h('div', null, String(hover.point.text || '').slice(0, 80))) : null),
        h('div', { className: 'sc-space-legend' },
          h('span', null, '颜色/大小 = 重要度（青→琥珀）'),
          h('span', null, '拖拽旋转 · 滚轮缩放 · 悬停摘要 · 点击详情')),
        selected ? h('div', { className: 'sc-space-detail' },
          h('div', { className: 'hd' },
            h('b', null, fmtMemAt(selected.at)),
            h(MemSourceTag, { raw: selected.sourceId || selected.platform || selected.channel }),
            selected.scene ? h(MemPill, { tone: 'off' }, String(selected.scene)) : null,
            h('span', null, '重要度 ' + String(selected.importance || 0))),
          h('div', { className: 'txt' }, selected.text || '（空文本）'),
          h('div', { className: 'meta' }, '投影坐标 x ' + Number(selected.x || 0).toFixed(2)
            + ' / y ' + Number(selected.y || 0).toFixed(2)
            + ' / z ' + Number(selected.z || 0).toFixed(2))) : null);
    }

    /* ── 记忆空间：模型选择 + 惰性加载（不点「查看空间」不请求） ───── */
    function MemorySpacePane(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const can = typeof props.can === 'function' ? props.can : () => true;
      const enabled = !!overview && can('projection');
      const statusRes = props.statusRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const modelsRes = props.modelsRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const spaces = (statusRes.data && statusRes.data.spaces) ? statusRes.data.spaces : {};
      const models = modelsRes.data || null;
      const findModel = (space) => {
        const local = models && Array.isArray(models.local) ? models.local.find((m) => m && m.modelSpace === space) : null;
        if (local) return local;
        if (models && Array.isArray(models.providers)) return models.providers.find((m) => m && m.modelSpace === space) || null;
        return null;
      };
      const options = Object.keys(spaces)
        .filter((space) => Number(spaces[space] && spaces[space].indexed) > 0)
        .sort()
        .map((space) => {
          const model = findModel(space);
          return {
            space,
            indexed: Number(spaces[space] && spaces[space].indexed) || 0,
            dim: Number(model && model.dim) || Number((/@(\d+)/.exec(space) || [])[1]) || 0,
          };
        });
      const [selected, setSelected] = useState('');
      const [target, setTarget] = useState(null);
      const result = useMemoryLoad(
        (signal) => api.vectorSpace({ modelSpace: target, limit: MEM_SPACE_LIMIT }, signal),
        [target],
        { enabled: !!target && enabled },
      );
      const view = result.data;
      const disabledReason = !overview
        ? '后端待接入：/overview 没读到，投影不可用。'
        : (!can('projection') ? '后端未开启投影（capabilities.projection=false）。' : '');
      const plainNote = h('div', { className: 'sc-space-plain' },
        h('span', null, h('b', null, '怎么画的'), '挑 3 个最能拉开差距的方向，把高维压成 3 维。'),
        h('span', null, h('b', null, '能干什么'), '只读观赏，像看星图；转一转、点一点，改不了任何东西。'));
      const load = () => {
        if (!enabled || !selected) return;
        if (target === selected) result.reload();
        else setTarget(selected);
      };
      const close = () => setTarget(null);

      if (statusRes.phase === 'loading' && !statusRes.data) {
        return h('div', { className: 'sc-mem-card' }, h('h4', null, '记忆空间 · 只读'), plainNote, h(MemLoading, { label: '正在读取模型空间…' }));
      }
      if (!statusRes.data && (statusRes.phase === 'failed' || statusRes.phase === 'unknown' || statusRes.phase === 'unavailable')) {
        return h('div', { className: 'sc-mem-card' },
          h('h4', null, '记忆空间 · 只读'),
          plainNote,
          h(MemErrorBlock, { phase: statusRes.phase, error: statusRes.error, onRetry: statusRes.reload }));
      }

      const info = view || {};
      const explained = Array.isArray(info.explained) && info.explained.length
        ? info.explained.map((x) => Math.round(Number(x) * 100) + '%').join(' / ')
        : '';
      return h('div', { className: 'sc-mem-card' },
        h('h4', null, '记忆空间 · 只读'),
        h('div', { className: 'hint' }, '选一个模型，点「查看空间」后才画；默认不加载。'),
        plainNote,
        !enabled ? h('div', { className: 'sc-mem-banner warn' }, disabledReason) : null,
        options.length ? h('div', { className: 'sc-mem-inline' },
          h('select', {
            className: 'sc-mem-input',
            value: selected,
            disabled: !enabled,
            onChange: (e) => { setSelected(e.target.value); setTarget(null); },
          },
            h('option', { value: '' }, '选择模型空间'),
            options.map((item) => h('option', { key: item.space, value: item.space },
              item.space + (item.dim ? ' · ' + item.dim + ' 维' : '') + ' · ' + item.indexed + ' 条'))),
          h('button', { className: 'sc-btn', disabled: !enabled || !selected, onClick: load }, result.phase === 'loading' ? '计算中…' : '查看空间'),
          target ? h('button', { className: 'sc-btn ghost', onClick: close }, '关闭空间') : null)
          : h('div', { className: 'sc-mem-empty' }, '还没有已建索引的模型空间。先到「总配置」重建/编码一个模型索引。'),
        !target ? h('div', { className: 'sc-space-idle' }, '选好模型后点「查看空间」；这一步才会请求投影。') : null,
        target && result.phase === 'loading' ? h(MemLoading, { label: '正在计算 / 读取 PCA3 投影…' }) : null,
        target && result.error ? h(MemErrorBlock, {
          phase: result.phase === 'unknown' ? 'unknown' : (result.error.notWired ? 'unavailable' : 'failed'),
          error: result.error,
          onRetry: result.reload,
        }) : null,
        target && view && !result.error ? h('div', null,
          h('div', { className: 'sc-space-meta' },
            h(MemPill, { tone: 'off' }, '只读'),
            h('span', null, String(info.modelSpace || target)),
            h('span', null, (info.dim || '?') + ' 维'),
            h('span', null, String(info.method || 'pca3').toUpperCase()),
            explained ? h('span', null, '解释方差 ' + explained) : null,
            h('span', null, '返回 ' + String(info.returned != null ? info.returned : (info.points || []).length) + ' / ' + String(info.total != null ? info.total : '?') + ' 点'),
            info.sampled ? h(MemPill, { tone: 'warn' }, '采样展示') : null,
            info.hidden ? h('span', null, '隐藏 ' + String(info.hidden) + ' 条敏感') : null),
          Array.isArray(info.explained) && info.explained.length && info.explained.reduce((sum, value) => sum + (Number(value) || 0), 0) < 0.35
            ? h('div', { className: 'sc-mem-note' }, '前三轴解释方差偏低，投影只保留部分结构；点间距离是近似。')
            : null,
          (info.points && info.points.length)
            ? h(MemorySpaceCanvas, { key: String(info.modelSpace || target) + ':' + String(info.updatedAt || ''), result: info })
            : h('div', { className: 'sc-mem-empty' }, '这个空间没有可展示的点（可能全是敏感记录或未编码）。')) : null,
        h('div', { className: 'sc-mem-note' }, '只是看个大概：点间距离是近似，不是原始千维坐标。'));
    }

    /* ── 向量记忆：总配置 / 本地模型 / 服务商模型 / 记录检索 / 记忆空间 ─ */
    function VectorPane(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const activeJob = props.activeJob || null;
      const onActiveJob = typeof props.onActiveJob === 'function' ? props.onActiveJob : null;
      const onRefreshOverview = typeof props.onRefreshOverview === 'function' ? props.onRefreshOverview : null;
      const [sub, setSub] = useState('config');
      const status = useMemoryLoad((signal) => api.vectorStatus(signal), []);
      const models = useMemoryLoad((signal) => api.vectorModels(signal), []);
      const job = useMemoryJob(activeJob ? activeJob.id : null, (phase) => {
        if (phase === 'done' || phase === 'failed') {
          status.reload();
          models.reload();
          if (onRefreshOverview) onRefreshOverview();
        }
      }, api);
      const reload = () => {
        status.reload();
        models.reload();
        if (onRefreshOverview) onRefreshOverview();
      };
      const startJob = (res, label) => {
        const data = (res && res.data) || {};
        if (data.jobId) {
          if (onActiveJob) onActiveJob({ id: data.jobId, label });
          return true;
        }
        return false;
      };
      const subtabs = [['config', '总配置'], ['local', '本地模型'], ['providers', '服务商模型'], ['library', '记录检索'], ['space', '记忆空间']];
      const jobUnsettled = job.phase === 'running' || job.phase === 'unknown';
      const libraryEnabled = !!overview && can('library');
      const libraryReason = !overview
        ? '后端待接入：/overview 没读到，记录检索暂不可用。'
        : (!can('library') ? '后端未开启记录检索（capabilities.library=false）。' : '');
      return h('div', null,
        h('div', { className: 'sc-mem-subtabs' }, subtabs.map((x) => h('button', {
          key: x[0],
          className: 'sc-mem-sub' + (sub === x[0] ? ' on' : ''),
          onClick: () => setSub(x[0]),
        }, x[1]))),
        activeJob ? h(MemJobBar, { state: job, label: activeJob.label || '向量任务', onRetry: reload }) : null,
        sub === 'config' ? h(VectorConfigTab, {
          api, overview, controlAvailable, can, statusRes: status, modelsRes: models,
          reload, startJob, jobBusy: jobUnsettled,
        }) : null,
        sub === 'local' ? h(LocalModelsTab, {
          api, modelsRes: models, controlAvailable, can, jobBusy: jobUnsettled, reload, startJob,
        }) : null,
        sub === 'providers' ? h(ProviderModelsTab, {
          api, modelsRes: models, overview, controlAvailable, can, onChanged: reload,
        }) : null,
        sub === 'library' ? h(LibraryPane, {
          api, can, enabled: libraryEnabled, disabledReason: libraryReason,
        }) : null,
        sub === 'space' ? h(MemorySpacePane, {
          api, statusRes: status, modelsRes: models, overview, can,
        }) : null);
    }

    function VectorConfigTab(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const statusRes = props.statusRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const modelsRes = props.modelsRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const reload = typeof props.reload === 'function' ? props.reload : () => {};
      const startJob = typeof props.startJob === 'function' ? props.startJob : () => false;
      const jobBusy = props.jobBusy === true;
      const status = statusRes.data || (overview && overview.vector) || null;
      const cfg = (overview && overview.config) || {};
      const currentSpace = (status && status.modelSpace) || cfg.modelSpace || 'default';
      const spaces = (status && status.spaces) || {};
      const records = Number(status && status.records) || 0;
      const indexed = Number(status && status.indexed) || 0;
      const pending = Number(status && status.pending) || 0;
      const failed = Number(status && status.failed) || 0;
      const batchSize = Number(cfg.batchSize) || 8;
      const models = modelsRes.data || null;
      const runtimeInfo = models && models.runtime ? models.runtime : null;
      const runtimeStatus = runtimeInfo ? String(runtimeInfo.status || 'unknown') : null;
      const statusFromOverview = !statusRes.data && !!(overview && overview.vector);

      const toggleAction = useMemoryAction();
      const maintainAction = useMemoryAction();
      const rebuildAction = useMemoryAction();
      const runtimeAction = useMemoryAction();
      const importAction = useMemoryAction();
      const [spaceDraft, setSpaceDraft] = useState('');
      const [confirmSpaces, setConfirmSpaces] = useState([]);
      const [spaceError, setSpaceError] = useState('');
      const [pickedSpaces, setPickedSpaces] = useState([]);
      const [fileError, setFileError] = useState('');
      const runtimeFile = useRef(null);
      const busy = jobBusy || toggleAction.busy || maintainAction.busy || rebuildAction.busy || runtimeAction.busy || importAction.busy;
      const canConfig = can('vectorConfig');
      const canMaintain = can('maintain');
      const canRebuild = can('rebuild');
      const canImportRuntime = can('modelsImport');
      const canRuntime = can('runtime');

      const saveEnabled = (next) => {
        if (!canConfig || busy) return;
        toggleAction.run(next ? '启用向量存储' : '停用向量存储', () => api.setVectorConfig({
          enabled: next,
          modelSpace: cfg.modelSpace || currentSpace || 'default',
          batchSize: Number(cfg.batchSize) || 8,
          maxChars: Number(cfg.maxChars) || 1200,
        })).then((res) => { if (res && res.ok) reload(); });
      };
      const runMaintain = () => {
        if (!canMaintain || busy) return;
        maintainAction.run('编码待处理', () => api.maintain(batchSize)).then((res) => {
          if (!res || !res.ok) return;
          if (!startJob(res, '编码待处理')) reload();
        });
      };
      const askRebuild = (input) => {
        const list = (Array.isArray(input) ? input : [input])
          .map((item) => String(item || '').trim())
          .filter(Boolean);
        const targets = [...new Set(list)];
        if (!targets.length) { setSpaceError('先填/选一个 modelSpace 再重建。'); return; }
        setSpaceError('');
        setConfirmSpaces(targets);
      };
      const togglePicked = (space) => {
        setPickedSpaces((prev) => (prev.includes(space) ? prev.filter((x) => x !== space) : [...prev, space]));
      };
      const doRebuild = () => {
        const targets = confirmSpaces.slice();
        if (!targets.length || !canRebuild || busy) return;
        setConfirmSpaces([]);
        setPickedSpaces([]);
        const label = targets.length === 1 ? ('重建 ' + targets[0]) : ('重建 ' + targets.length + ' 个索引');
        rebuildAction.run(label, () => api.rebuild(targets)).then((res) => {
          if (!res || !res.ok) return;
          if (!startJob(res, label)) reload();
        });
      };
      const importRuntime = (file) => {
        if (!file || !canImportRuntime || busy) return;
        if (!/\.zip$/i.test(file.name || '')) { setFileError('只接受 .zip 文件'); return; }
        setFileError('');
        importAction.run('导入运行时', () => api.importModel(file, 'runtime')).then((res) => {
          if (!res || !res.ok) return;
          if (!startJob(res, '导入运行时')) modelsRes.reload();
        });
      };
      const toggleRuntime = () => {
        if (!canRuntime || busy || !runtimeStatus || runtimeStatus === 'not-installed') return;
        const next = runtimeStatus !== 'running';
        runtimeAction.run(next ? '启用运行时' : '停用运行时', () => api.enableRuntime(next)).then((res) => {
          if (!res || !res.ok) return;
          if (!startJob(res, next ? '启用运行时' : '停用运行时')) modelsRes.reload();
        });
      };
      const actionError = (action, retry, refresh) => {
        if (!action || !action.error) return null;
        const phase = action.error.notWired ? 'unavailable' : (action.phase === 'unknown' ? 'unknown' : 'failed');
        const onRetry = phase === 'unavailable' ? retry : (phase === 'unknown' ? refresh : retry);
        const retryLabel = phase === 'unavailable' ? '重试接入' : (phase === 'unknown' ? '刷新状态' : '重试');
        return h(MemErrorBlock, { phase, error: action.error, compact: true, onRetry, retryLabel });
      };
      const blocked = (action) => !!(action && action.phase === 'failed' && action.error && action.error.notWired);
      const jobAccepted = (action) => !!(action && action.data && action.data.jobId);
      const successNote = (text, action, extra) => h('div', { className: 'sc-mem-inline-ok' }, text + (extra ? '：' + extra : '') + ' · ' + fmtClock(action.at));

      return h('div', null,
        h('div', { className: 'sc-mem-card' },
          h('div', { className: 'sc-mem-card-hd' },
            h('h4', null, '向量状态'),
            h(MemSource, { phase: statusRes.phase, at: statusRes.at, note: 'GET /surfcore-api/memory/vector/status' }),
            h('span', { className: 'sc-spacer' }),
            h('button', { className: 'sc-btn ghost', onClick: reload, disabled: statusRes.phase === 'loading' }, '刷新')),
          statusRes.phase === 'loading' && !status ? h(MemLoading, { label: '正在读取向量状态…' }) : null,
          statusRes.phase !== 'loading' && !status ? h(MemErrorBlock, { phase: statusRes.phase, error: statusRes.error, onRetry: statusRes.reload }) : null,
          statusFromOverview ? h('div', { className: 'sc-mem-note' }, '/vector/status 没读到，下面数字回退自 /overview.vector。') : null,
          status ? h('div', null,
            h('div', { className: 'sc-mem-status' },
              h('div', null, h('b', null, String(records)), h('span', null, '向量记录')),
              h('div', null, h('b', null, String(indexed)), h('span', null, '已索引')),
              h('div', null, h('b', null, String(pending)), h('span', null, '待编码')),
              h('div', null, h('b', null, String(failed)), h('span', null, '失败'))),
            h('div', { className: 'hint' }, '当前索引：' + currentSpace + ' · ' + (cfg.enabled === false ? '向量存储已关闭' : '向量存储开启')),
            records === 0 && Object.keys(spaces).length
              ? h('div', { className: 'sc-mem-note' }, '记录源当前为 0 条，下面是历史索引统计（索引里有旧数据，不代表记录源有这些条）；先恢复/生成记录再编码。')
              : null,
            statusRes.phase === 'failed' || statusRes.phase === 'unknown' ? h(MemErrorBlock, { phase: statusRes.phase, error: statusRes.error, compact: true, onRetry: statusRes.reload }) : null) : null,
          h('div', { className: 'sc-mem-note' }, '接口：GET /vector/status · 只读；写动作在下面两张卡。')),

        h('div', { className: 'sc-mem-card' },
          h('h4', null, '总配置 · 启停与编码'),
          h('div', { className: 'sc-mem-row' },
            h('div', null,
              h('div', { className: 'k' }, '向量存储'),
              h('div', { className: 'hint' }, '关掉 = 不再摄取/编码；叙事记忆不受影响。接口：POST /vector/config')),
            h('button', {
              className: 'sc-btn' + (cfg.enabled === false ? '' : ' ghost'),
              disabled: !canConfig || !overview || busy || blocked(toggleAction),
              title: canConfig ? '接口：POST /surfcore-api/memory/vector/config' : '后端未开启这个动作（capabilities.vectorConfig=false）',
              onClick: () => saveEnabled(cfg.enabled === false),
            }, toggleAction.busy ? '保存中…' : (!overview ? '待接入' : (cfg.enabled === false ? '启用它' : '停用它')))),
          actionError(toggleAction, () => saveEnabled(cfg.enabled === false), reload),
          toggleAction.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' }, '已保存 · ' + fmtClock(toggleAction.at)) : null,

          h('div', { className: 'sc-mem-row' },
            h('div', null,
              h('div', { className: 'k' }, '编码待处理 · ' + pending + ' 条'),
              h('div', { className: 'hint' }, '接口：POST /vector/maintain，一批 ' + batchSize + ' 条；可重复点到 0。')),
            h('button', { className: 'sc-btn ghost', disabled: !canMaintain || busy || pending === 0 || blocked(maintainAction), onClick: runMaintain }, maintainAction.busy ? '编码中…' : '编码一批')),
          actionError(maintainAction, runMaintain, reload),
          maintainAction.phase === 'success' ? successNote(jobAccepted(maintainAction) ? '已提交编码任务' : '后端已接受（没有 jobId，进度未知）', maintainAction) : null,
          !controlAvailable ? h('div', { className: 'sc-mem-banner warn' }, '后端待补充：overview.controlAvailable=false，写按钮禁用。') : null),

        h('div', { className: 'sc-mem-card' },
          h('h4', null, '模型索引 · 多模型重建'),
          h('div', { className: 'hint' }, '每个模型一套索引；可以多选后一次提交（后端按 modelSpaces 批处理），也可以单独重建。重建完成后还要「编码一批」。'),
          Object.keys(spaces).length ? h('div', { className: 'sc-mem-index' },
            h('div', { className: 'hd' },
              h('span', null, '模型索引'), h('span', null, '已索引'), h('span', null, '待编码'), h('span', null, '失败'), h('span', null, '')),
            Object.keys(spaces).map((space) => {
              const row = spaces[space] || {};
              return h('div', { className: 'tr', key: space },
                h('span', { className: 'nm', title: space },
                  h('input', {
                    type: 'checkbox',
                    checked: pickedSpaces.includes(space),
                    disabled: !canRebuild || busy,
                    onChange: () => togglePicked(space),
                  }),
                  space, space === currentSpace ? h('i', null, '当前') : null),
                h('span', null, String(row.indexed || 0)),
                h('span', null, String(row.pending || 0)),
                h('span', null, String(row.failed || 0)),
                h('button', {
                  className: 'sc-btn ghost',
                  disabled: !canRebuild || busy || blocked(rebuildAction),
                  title: canRebuild ? '接口：POST /surfcore-api/memory/vector/rebuild' : '后端未开启这个动作（capabilities.rebuild=false）',
                  onClick: () => askRebuild(space),
                }, '重建'));
            })) : h('div', { className: 'sc-mem-empty' }, status ? '还没有任何模型索引。先配置服务商或导入本地模型，再重建。' : '向量状态没读到，无法列出模型索引（后面接口接入后再显示）。'),
          h('div', { className: 'sc-mem-inline' },
            h('button', {
              className: 'sc-btn ghost',
              disabled: !canRebuild || busy || !pickedSpaces.length || blocked(rebuildAction),
              onClick: () => askRebuild(pickedSpaces),
            }, '重建所选（' + pickedSpaces.length + '）'),
            h('input', {
              className: 'sc-mem-input',
              value: spaceDraft,
              placeholder: '新的 modelSpace，例如 ' + currentSpace,
              disabled: !canRebuild || busy,
              onChange: (e) => { setSpaceDraft(e.target.value); if (spaceError) setSpaceError(''); },
            }),
            h('button', { className: 'sc-btn ghost', disabled: !canRebuild || busy || !spaceDraft.trim() || blocked(rebuildAction), onClick: () => askRebuild(spaceDraft) }, '为这个模型重建')),
          spaceError ? h('div', { className: 'sc-mem-confirm' }, spaceError) : null,
          confirmSpaces.length ? h('div', { className: 'sc-mem-confirm' },
            '确认重建 ' + confirmSpaces.length + ' 个索引：' + confirmSpaces.join('、') + '？会重新编码这些模型空间，其他索引不动。',
            h('div', { className: 'sc-mem-actions' },
              h('button', { className: 'sc-btn ghost', onClick: () => setConfirmSpaces([]) }, '取消'),
              h('button', { className: 'sc-btn', disabled: !canRebuild || busy || blocked(rebuildAction), onClick: doRebuild }, rebuildAction.busy ? '重建中…' : '确认重建'))) : null,
          actionError(rebuildAction, doRebuild, reload),
          rebuildAction.phase === 'success' ? successNote(jobAccepted(rebuildAction) ? '已提交重建任务' : '后端已接受（没有 jobId，进度未知）', rebuildAction) : null),

        h('div', { className: 'sc-mem-card' },
          h('div', { className: 'sc-mem-card-hd' },
            h('h4', null, '本地运行时'),
            h(MemSource, { phase: modelsRes.phase, at: modelsRes.at, note: 'GET /surfcore-api/memory/vector/models' }),
            h('span', { className: 'sc-spacer' }),
            h('button', { className: 'sc-btn ghost', onClick: modelsRes.reload, disabled: modelsRes.phase === 'loading' }, '刷新')),
          modelsRes.phase === 'loading' && !models ? h(MemLoading, { label: '正在读取运行时状态…' }) : null,
          modelsRes.phase !== 'loading' && !models ? h(MemErrorBlock, { phase: modelsRes.phase, error: modelsRes.error, onRetry: modelsRes.reload }) : null,
          models && !runtimeInfo ? h('div', { className: 'sc-mem-empty' }, '后端没有返回运行时状态（/vector/models.runtime）。') : null,
          runtimeInfo ? h('div', { className: 'sc-mem-row' },
            h('div', null,
              h('div', { className: 'k' }, '运行时 · ' + (MEM_MODEL_STATUS[runtimeStatus] || runtimeStatus || '未知')),
              h('div', { className: 'hint' }, '版本 ' + (runtimeInfo.version || '未知') + ' · 接口：POST /runtime/enable')),
            h('div', { className: 'sc-mem-actions', style: { margin: 0 } },
              h('button', { className: 'sc-btn ghost', disabled: !canImportRuntime || busy || blocked(importAction), title: canImportRuntime ? '接口：POST /surfcore-api/memory/models/import' : '后端未开启这个动作（capabilities.modelsImport=false）', onClick: () => { if (runtimeFile.current) runtimeFile.current.click(); } }, importAction.busy ? '导入中…' : '导入运行时 zip'),
              h('button', {
                className: 'sc-btn ghost',
                disabled: !canRuntime || busy || runtimeStatus === 'not-installed' || blocked(runtimeAction),
                title: runtimeStatus === 'not-installed' ? '先导入运行时' : (canRuntime ? '接口：POST /surfcore-api/memory/runtime/enable' : '后端未开启这个动作（capabilities.runtime=false）'),
                onClick: toggleRuntime,
              }, runtimeAction.busy ? '提交中…' : (runtimeStatus === 'running' ? '停用' : '启用它')))) : null,
          h('input', {
            type: 'file', accept: '.zip', ref: runtimeFile, style: { display: 'none' },
            onChange: (e) => {
              const file = e.target.files && e.target.files[0];
              try { e.target.value = ''; } catch (error) { /* 忽略 */ }
              importRuntime(file);
            },
          }),
          fileError ? h('div', { className: 'sc-mem-inline-err' }, fileError) : null,
          actionError(importAction, () => { if (runtimeFile.current) runtimeFile.current.click(); }, () => modelsRes.reload()),
          importAction.phase === 'success' ? successNote(jobAccepted(importAction) ? '已提交运行时导入' : '后端已接受（没有 jobId，进度未知）', importAction) : null,
          actionError(runtimeAction, toggleRuntime, reload),
          runtimeAction.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' },
            (jobAccepted(runtimeAction)
              ? '已提交运行时任务'
              : '运行时返回：' + ((runtimeAction.data && (runtimeAction.data.status || runtimeAction.data.state)) || '已接受（没有 jobId）'))
            + ' · ' + fmtClock(runtimeAction.at)) : null,
          h('div', { className: 'sc-mem-note' }, '导入由后端解压并校验 pack.json；失败会显示 pack.* 的 code/hint，不会假进度。')));
    }

    function LocalModelsTab(props) {
      const api = props.api || memApi;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const jobBusy = props.jobBusy === true;
      const startJob = typeof props.startJob === 'function' ? props.startJob : null;
      const reload = typeof props.reload === 'function' ? props.reload : () => {};
      const modelsRes = props.modelsRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const local = (modelsRes.data && Array.isArray(modelsRes.data.local)) ? modelsRes.data.local : null;
      const slots = Math.max(3, local ? local.length : 0);
      const canImport = can('modelsImport') && !!modelsRes.data && !jobBusy;
      return h('div', { className: 'sc-mem-card' },
        h('div', { className: 'sc-mem-card-hd' },
          h('h4', null, '本地模型 · 3 个 zip 槽位'),
          h(MemSource, { phase: modelsRes.phase, at: modelsRes.at, note: 'GET /surfcore-api/memory/vector/models' }),
          h('span', { className: 'sc-spacer' }),
          h('button', { className: 'sc-btn ghost', onClick: modelsRes.reload, disabled: modelsRes.phase === 'loading' }, '刷新')),
        h('div', { className: 'hint' }, '槽位清单来自后端；接口没实现时返回空数组，这里就是空槽，不编造假模型。'),
        modelsRes.phase === 'loading' && !local ? h(MemLoading, { label: '正在读取本地模型…' }) : null,
        modelsRes.phase !== 'loading' && !local ? h(MemErrorBlock, { phase: modelsRes.phase, error: modelsRes.error, onRetry: modelsRes.reload }) : null,
        local ? h('div', null,
          h('div', { className: 'sc-mem-grid' }, Array.from({ length: slots }).map((_, i) => h(LocalModelSlot, {
            key: 'slot-' + i,
            index: i,
            model: local[i] || null,
            api,
            canImport,
            startJob,
            reload,
          }))),
          local.length > 3 ? h('div', { className: 'sc-mem-note' }, '后端检测到 ' + local.length + ' 个本地模型；前 3 个是固定槽位，多出的按「已检测」展示。') : null,
          modelsRes.phase === 'failed' || modelsRes.phase === 'unknown' ? h(MemErrorBlock, { phase: modelsRes.phase, error: modelsRes.error, compact: true, onRetry: modelsRes.reload }) : null)
          : (modelsRes.phase === 'loading' ? null : h('div', null,
            h('div', { className: 'sc-mem-grid' }, Array.from({ length: 3 }).map((_, i) => h(LocalModelSlot, {
              key: 'slot-placeholder-' + i, index: i, model: null, api, canImport: false, startJob: null, reload, unknown: true,
            }))),
            h('div', { className: 'sc-mem-note' }, '清单没读到，这三个只是槽位占位；接口接入后按后端返回渲染。'))),
        h('div', { className: 'sc-mem-note' }, '接口：POST /models/import（multipart：file + kind=local-model）→ job；进度用 GET /jobs/:id。'));
    }

    function LocalModelSlot(props) {
      const api = props.api || memApi;
      const index = Number(props.index) || 0;
      const model = props.model || null;
      const unknown = props.unknown === true;
      const canImport = props.canImport === true;
      const startJob = typeof props.startJob === 'function' ? props.startJob : null;
      const reload = typeof props.reload === 'function' ? props.reload : () => {};
      const action = useMemoryAction();
      const fileRef = useRef(null);
      const [pendingFile, setPendingFile] = useState(null);
      const [fileError, setFileError] = useState('');
      const installed = !!model && model.status !== 'not-installed';
      const blocked = !!(action.phase === 'failed' && action.error && action.error.notWired);
      const doImport = (file) => {
        if (!file) return;
        action.run('导入槽位 #' + (index + 1), () => api.importModel(file, 'local-model')).then((res) => {
          setPendingFile(null);
          if (!res || !res.ok) return;
          if (!startJob || !startJob(res, '导入槽位 #' + (index + 1))) reload();
        });
      };
      const onFile = (e) => {
        const file = e.target.files && e.target.files[0];
        try { e.target.value = ''; } catch (error) { /* 忽略 */ }
        if (!file) return;
        if (!/\.zip$/i.test(file.name || '')) { setFileError('只接受 .zip 文件'); return; }
        setFileError('');
        if (installed) { setPendingFile(file); return; }
        doImport(file);
      };
      return h('div', { className: 'sc-mem-slot' + (model ? ' occupied' : '') },
        h('div', { className: 't' }, model
          ? ((model.name || '本地模型') + (model.version ? ' v' + model.version : ''))
          : ('槽位 #' + (index + 1) + (unknown ? ' · 待接入' : ' · 空'))),
        h('div', { className: 's' }, model
          ? ((MEM_MODEL_STATUS[model.status] || model.status || '状态未知')
            + (model.dim ? ' · ' + model.dim + ' 维' : '')
            + (model.sizeBytes ? ' · ' + fmtBytes(model.sizeBytes) : '')
            + (model.indexReady ? ' · 索引 ' + (Number(model.indexed) || 0) + ' 条' : ' · 未建索引'))
          : (unknown ? '清单没读到（/vector/models）' : '未安装（导入 zip 后由后端检测）')),
        h('div', { className: 'sc-mem-slot-actions' },
          h('button', {
            className: 'sc-btn ghost',
            disabled: !canImport || action.busy || blocked,
            title: canImport ? '接口：POST /surfcore-api/memory/models/import' : '后端待接入或任务进行中',
            onClick: () => { if (fileRef.current) fileRef.current.click(); },
          }, action.busy ? '导入中…' : (installed ? '替换 zip' : '导入 zip')),
          model && model.id ? h(MemPill, { tone: 'off' }, String(model.id)) : null),
        h('input', { type: 'file', accept: '.zip', ref: fileRef, style: { display: 'none' }, onChange: onFile }),
        pendingFile ? h('div', { className: 'sc-mem-confirm' },
          '槽位已有模型。用「' + pendingFile.name + '」覆盖？',
          h('div', { className: 'sc-mem-actions' },
            h('button', { className: 'sc-btn ghost', onClick: () => setPendingFile(null) }, '取消'),
            h('button', { className: 'sc-btn', disabled: action.busy || blocked, onClick: () => doImport(pendingFile) }, '确认导入'))) : null,
        fileError ? h('div', { className: 'sc-mem-inline-err' }, fileError) : null,
        action.error ? h(MemErrorBlock, {
          phase: action.error.notWired ? 'unavailable' : (action.phase === 'unknown' ? 'unknown' : 'failed'),
          error: action.error,
          compact: true,
          onRetry: action.phase === 'unknown' ? reload : null,
          retryLabel: '刷新状态',
        }) : null,
        action.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' },
          (action.data && action.data.jobId ? '已提交导入任务' : '后端已接受导入请求（没有 jobId，进度未知）')
          + ' · ' + fmtClock(action.at)) : null);
    }

    function ProviderModelsTab(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const onChanged = typeof props.onChanged === 'function' ? props.onChanged : () => {};
      const modelsRes = props.modelsRes || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const [active, setActive] = useState('siliconflow');
      const providers = (modelsRes.data && Array.isArray(modelsRes.data.providers)) ? modelsRes.data.providers : [];
      const rows = MEM_PROVIDER_TABS.map((base) => {
        const hit = providers.find((x) => {
          if (!x || typeof x !== 'object') return false;
          const id = String(x.id || '').toLowerCase();
          const name = String(x.name || '').toLowerCase();
          if (base.ids.indexOf(id) >= 0) return true;
          return base.names.some((n) => name.indexOf(String(n).toLowerCase()) >= 0);
        }) || null;
        return {
          tabId: base.id,
          id: (hit && hit.id) || base.id,
          name: (hit && hit.name) || base.name,
          configured: !!(hit && hit.configured === true),
          status: hit ? String(hit.status || 'unknown') : 'unknown',
          listed: !!hit,
          endpoint: String((hit && hit.endpoint) || ''),
          model: String((hit && hit.model) || ''),
          modelSpace: String((hit && hit.modelSpace) || ''),
          hasKey: !!(hit && hit.hasKey === true),
          keyMasked: String((hit && hit.keyMasked) || ''),
        };
      });
      const current = rows.find((x) => x.tabId === active) || rows[0];
      return h('div', { className: 'sc-mem-card' },
        h('div', { className: 'sc-mem-card-hd' },
          h('h4', null, '服务商模型'),
          h(MemSource, { phase: modelsRes.phase, at: modelsRes.at, note: 'GET /surfcore-api/memory/vector/models' }),
          h('span', { className: 'sc-spacer' }),
          h('button', { className: 'sc-btn ghost', onClick: modelsRes.reload, disabled: modelsRes.phase === 'loading' }, '刷新')),
        h('div', { className: 'hint' }, '四家服务商固定入口；Endpoint/模型/索引标识来自 /vector/models 已保存值，Key 永不回显。'),
        modelsRes.phase === 'loading' && !modelsRes.data ? h(MemLoading, { label: '正在读取服务商状态…' }) : null,
        modelsRes.phase !== 'loading' && !modelsRes.data ? h(MemErrorBlock, { phase: modelsRes.phase, error: modelsRes.error, onRetry: modelsRes.reload }) : null,
        h('div', { className: 'sc-mem-provider' }, rows.map((p) => h('button', {
          key: p.tabId,
          className: 'sc-mem-sub' + (active === p.tabId ? ' on' : ''),
          onClick: () => setActive(p.tabId),
        }, p.name, p.configured ? h('i', { className: 'dot' }) : null))),
        current.listed ? null : h('div', { className: 'sc-mem-banner warn' }, 'GET /vector/models 没返回「' + current.name + '」；状态未知，但配置接口仍按契约可用。'),
        h(ProviderForm, { key: current.tabId, provider: current, api, overview, controlAvailable, can, onChanged }),
        h('div', { className: 'sc-mem-note' }, '接口：POST /providers/:id/config · POST /providers/:id/test（Key 只写不回显）。'));
    }

    function ProviderForm(props) {
      const provider = props.provider;
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const onChanged = typeof props.onChanged === 'function' ? props.onChanged : () => {};
      const [endpoint, setEndpoint] = useState(String(provider.endpoint || ''));
      const [model, setModel] = useState(String(provider.model || ''));
      const [apiKey, setApiKey] = useState('');
      const [space, setSpace] = useState(String(provider.modelSpace || (overview && overview.config && overview.config.modelSpace) || ''));
      const [formError, setFormError] = useState('');
      const [savedConfigured, setSavedConfigured] = useState(null);
      const save = useMemoryAction();
      const test = useMemoryAction();
      const configured = savedConfigured !== null ? savedConfigured : provider.configured === true;
      const status = provider.listed ? (MEM_PROVIDER_STATUS[provider.status] || provider.status) : '状态未知';
      const saveBlocked = !!(save.phase === 'failed' && save.error && save.error.notWired);
      const testBlocked = !!(test.phase === 'failed' && test.error && test.error.notWired);
      const canConfig = can('providerConfig');
      const canTest = can('providerTest');
      const canEdit = canConfig && !save.busy && !test.busy && !saveBlocked;

      useEffect(() => {
        setEndpoint(String(provider.endpoint || ''));
        setModel(String(provider.model || ''));
        setSpace(String(provider.modelSpace || (overview && overview.config && overview.config.modelSpace) || ''));
        setFormError('');
        // 只跟随后端回读值；不覆盖用户正在输入的 Key
      }, [provider.id, provider.endpoint, provider.model, provider.modelSpace]);

      const doSave = () => {
        if (!canEdit) return;
        setFormError('');
        const ep = endpoint.trim();
        const md = model.trim();
        if (!ep) { setFormError('先填 Endpoint（服务商文档里的 embeddings 地址）'); return; }
        if (!/^https?:\/\//i.test(ep)) { setFormError('Endpoint 需要以 http:// 或 https:// 开头'); return; }
        if (!md) { setFormError('先填模型名'); return; }
        const body = { endpoint: ep, model: md };
        if (space.trim()) body.modelSpace = space.trim();
        if (apiKey.trim()) body.apiKey = apiKey.trim();
        save.run('保存服务商配置', () => api.saveProvider(provider.id, body)).then((res) => {
          if (!res || !res.ok) return;
          setApiKey('');
          setSavedConfigured(!(res.data && res.data.configured === false));
          onChanged();
        });
      };
      const doTest = () => {
        if (!canTest || !configured) return;
        test.run('测试服务', () => api.testProvider(provider.id)).then((res) => {
          if (res && res.ok) onChanged();
        });
      };
      const result = test.phase === 'success' ? test.data || test.raw || {} : null;
      const dim = result && result.dim != null ? Number(result.dim) : null;
      const latency = result && result.latencyMs != null ? Number(result.latencyMs) : null;
      const resultText = result
        ? ('测试通过' + (dim ? ' · ' + dim + ' 维' : '') + (latency != null ? ' · ' + latency + ' ms' : '') + (!dim && latency == null ? '（后端没返回维度/延迟）' : ''))
        : '';
      return h('div', null,
        h('div', { className: 'sc-mem-card-hd', style: { marginTop: 10 } },
          h('h4', null, provider.name),
          h(MemPill, { tone: configured ? 'ok' : 'off' }, configured ? '已配置' : '未配置'),
          h(MemPill, { tone: provider.status === 'ready' ? 'ok' : (provider.status === 'error' || provider.status === 'no-index') ? 'warn' : 'off' }, status),
          h('span', { className: 'sc-spacer' }),
          h('span', { className: 'sc-mem-note', style: { marginTop: 0 } }, '接口：POST /providers/' + provider.id + '/config')),
        h('div', { className: 'sc-mem-field' },
          h('label', null, 'Endpoint'),
          h('input', {
            value: endpoint, disabled: !canEdit, placeholder: 'https://…/v1/embeddings', autoComplete: 'off',
            onChange: (e) => setEndpoint(e.target.value),
          })),
        h('div', { className: 'sc-mem-field' },
          h('label', null, '模型名'),
          h('input', {
            value: model, disabled: !canEdit, placeholder: 'embedding model', autoComplete: 'off',
            onChange: (e) => setModel(e.target.value),
          })),
        h('div', { className: 'sc-mem-field' },
          h('label', null, 'API Key（只写不回显）'),
          h('input', {
            type: 'password', value: apiKey, disabled: !canEdit, autoComplete: 'new-password',
            placeholder: configured ? '********（已保存；留空不修改）' : '未配置',
            onChange: (e) => setApiKey(e.target.value),
          })),
        h('div', { className: 'sc-mem-field' },
          h('label', null, '索引标识 modelSpace（可选）'),
          h('input', {
            value: space, disabled: !canEdit, placeholder: '例如 bge-m3@1024-cloud-v1', autoComplete: 'off',
            onChange: (e) => setSpace(e.target.value),
          })),
        h('div', { className: 'hint' }, 'Endpoint/模型/索引标识已按后端已保存值回填；Key 只写不回显，留空 = 不修改。保存不会切换当前索引；测试按 id 直测，不切 active。'),
        formError ? h('div', { className: 'sc-mem-inline-err' }, formError) : null,
        h('div', { className: 'sc-mem-actions' },
          h('button', { className: 'sc-btn', disabled: !canEdit || saveBlocked, onClick: doSave }, save.busy ? '保存中…' : '保存'),
          h('button', {
            className: 'sc-btn ghost',
            disabled: !canTest || !configured || testBlocked,
            title: !configured ? '先保存配置再测试' : (canTest ? '接口：POST /surfcore-api/memory/providers/:id/test' : '后端未开启这个动作（capabilities.providerTest=false）'),
            onClick: doTest,
          }, test.busy ? '测试中…' : '测试服务')),
        save.error ? h(MemErrorBlock, {
          phase: save.error.notWired ? 'unavailable' : (save.phase === 'unknown' ? 'unknown' : 'failed'),
          error: save.error, compact: true, onRetry: saveBlocked ? null : doSave,
        }) : null,
        save.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' }, '已保存 · ' + fmtClock(save.at)) : null,
        test.error ? h(MemErrorBlock, {
          phase: test.error.notWired ? 'unavailable' : (test.phase === 'unknown' ? 'unknown' : 'failed'),
          error: test.error, compact: true, onRetry: testBlocked ? null : doTest,
        }) : null,
        test.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' }, resultText) : null,
        !controlAvailable ? h('div', { className: 'sc-mem-banner warn' }, '后端待补充：controlAvailable=false，保存/测试禁用。')
          : (!canConfig ? h('div', { className: 'sc-mem-banner warn' }, '后端未开启服务商配置（capabilities.providerConfig=false），保存禁用。') : null));
    }

    /* ── 8 项可调设置 ─────────────────────────────────────────────── */
    function MemorySettingsPanel(props) {
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const onChanged = typeof props.onChanged === 'function' ? props.onChanged : () => {};
      const resource = props.resource || { phase: 'idle', data: null, error: null, at: 0, reload: () => {} };
      const apiFields = resource.data && Array.isArray(resource.data.fields) ? resource.data.fields : null;
      const fallback = KERNEL_DATA.settings.filter((s) => s.block === 'memory').map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        cost: s.cost,
        type: Array.isArray(s.options) && s.options.length ? 'choice' : 'text',
        options: Array.isArray(s.options) ? s.options : [],
        value: undefined,
        isDefault: s.isDefault,
        group: null,
        warning: null,
        fallback: true,
      }));
      const hasApiData = !!resource.data;
      const fallbackAllowed = !hasApiData && (resource.phase === 'unavailable' || resource.phase === 'failed' || resource.phase === 'unknown' || resource.phase === 'idle');
      const fields = hasApiData ? (apiFields || []) : (fallbackAllowed ? fallback : []);
      const usingFallback = fallbackAllowed;
      const readFailed = !hasApiData && (resource.phase === 'failed' || resource.phase === 'unknown' || resource.phase === 'unavailable');
      return h('div', { className: 'sc-mem-card' },
        h('div', { className: 'sc-mem-card-hd' },
          h('h4', null, '可调设置 · ' + fields.length + ' 项'),
          h(MemSource, { phase: resource.phase, at: resource.at, note: 'GET /surfcore-api/memory/settings' }),
          h('span', { className: 'sc-spacer' }),
          h('button', { className: 'sc-btn ghost', onClick: resource.reload, disabled: resource.phase === 'loading' }, '刷新')),
        usingFallback ? h('div', { className: 'sc-mem-banner warn' }, '当前值没读到（后端待接入）。下面只显示构建时的设置声明，控件全部禁用；不拿快照值冒充实时。') : null,
        resource.phase === 'loading' && !hasApiData ? h(MemLoading, { label: '正在读取设置…' }) : null,
        readFailed && !usingFallback ? h(MemErrorBlock, { phase: resource.phase, error: resource.error, onRetry: resource.reload }) : null,
        !hasApiData && resource.phase === 'empty' ? h(MemEmpty, null, '后端没有返回设置项。') : null,
        hasApiData && !fields.length ? h(MemEmpty, null, '后端没有返回设置项。') : null,
        fields.length
          ? h('div', null, fields.map((field) => h(MemorySettingRow, {
            key: field.key, field, api, overview, controlAvailable, can, onChanged,
          })))
          : null,
        h('div', { className: 'sc-mem-note' }, '接口：memory.mode → POST /mode；memory.vector.* → POST /vector/config；memory.maxRecords 后端标 writable，但 v1 没有保存路由（待补充）；memory.dedupeDays / initialDays 为 writable:false，只读。'));
    }

    function memSettingWriter(api, overview, field, value) {
      if (field.key === 'memory.mode') return api.setMode(String(value));
      if (String(field.key).indexOf('memory.vector.') === 0) {
        const cfg = Object.assign({}, (overview && overview.config) || {});
        const body = {
          enabled: cfg.enabled !== false,
          modelSpace: cfg.modelSpace || 'default',
          batchSize: Number(cfg.batchSize) || 8,
          maxChars: Number(cfg.maxChars) || 1200,
        };
        if (field.key === 'memory.vector.enabled') body.enabled = value === true || String(value) === 'true';
        else if (field.key === 'memory.vector.modelSpace') body.modelSpace = String(value).trim();
        else if (field.key === 'memory.vector.batchSize') body.batchSize = Number(value);
        else if (field.key === 'memory.vector.maxChars') body.maxChars = Number(value);
        return api.setVectorConfig(body);
      }
      return Promise.resolve({
        ok: false,
        error: field.key === 'memory.maxRecords'
          ? memErr('memory.settings-route-missing', '后端标注这一项可写，但 v1 没有保存路由', '等后端补 POST /settings 后再保存；现在不会假装写入', { retryable: false, notWired: true })
          : memErr('memory.settings-not-wired', '这一项还没有保存接口', '契约 v1 只开放 memory.mode 与 memory.vector.*；等后端补设置写入', { retryable: false, notWired: true }),
      });
    }

    function MemorySettingRow(props) {
      const field = props.field || {};
      const api = props.api || memApi;
      const overview = props.overview || null;
      const controlAvailable = props.controlAvailable === true;
      const can = typeof props.can === 'function' ? props.can : () => controlAvailable;
      const onChanged = typeof props.onChanged === 'function' ? props.onChanged : () => {};
      const key = String(field.key || '');
      const [draft, setDraft] = useState(field.value);
      const [invalid, setInvalid] = useState('');
      const action = useMemoryAction();
      useEffect(() => { setDraft(field.value); setInvalid(''); }, [field.value]);
      const hasEndpoint = key === 'memory.mode' || key.indexOf('memory.vector.') === 0;
      const capKey = key === 'memory.mode' ? 'mode' : (key.indexOf('memory.vector.') === 0 ? 'vectorConfig' : '');
      const capBlocked = Boolean(capKey) && !can(capKey);
      const reason = field.fallback ? '待补充：当前值没读到（后端待接入）'
        : field.writable === false ? '后端只读（writable:false）：当前运行时没有这一项的生效点'
          : !hasEndpoint ? '后端标注可写，但 v1 没有保存路由（待补充）'
            : capBlocked ? '后端未开启这个动作（capabilities.' + capKey + '=false）'
              : !controlAvailable ? '后端待补充：controlAvailable=false'
                : !overview ? '读不到总配置（GET /overview），保存会丢字段'
                  : '';
      const dirty = !memSame(draft, field.value);
      const blocked = !!(action.phase === 'failed' && action.error && action.error.notWired);
      const disabled = !!reason || action.busy || !dirty || blocked;
      const doSave = () => {
        if (disabled) return;
        setInvalid('');
        if (key === 'memory.vector.modelSpace') {
          const next = String(draft == null ? '' : draft).trim();
          if (!next) { setInvalid('索引标识不能为空'); return; }
          if (next.length > 80) { setInvalid('索引标识最多 80 个字符'); return; }
        }
        if ((key === 'memory.vector.batchSize' || key === 'memory.vector.maxChars')
          && (!Number.isFinite(Number(draft)) || Number(draft) <= 0)) {
          setInvalid('需要一个正数');
          return;
        }
        action.run('保存 ' + (field.label || key), () => memSettingWriter(api, overview, field, draft)).then((res) => {
          if (res && res.ok) onChanged();
        });
      };
      const options = Array.isArray(field.options) ? field.options : [];
      const isBool = typeof field.value === 'boolean' || (options.length === 2 && options.every((x) => typeof x === 'boolean'));
      let editor = null;
      if (field.fallback) {
        editor = h('span', { className: 'sc-mem-unknown' }, '值待接入');
      } else if (isBool) {
        editor = h('button', {
          type: 'button',
          className: 'sc-mem-switch' + (draft === true ? ' on' : ''),
          disabled: !!reason || action.busy,
          role: 'switch',
          'aria-checked': draft === true,
          onClick: () => setDraft(draft !== true),
        }, h('i'), h('span', null, draft === true ? '开启' : '关闭'));
      } else if (options.length) {
        editor = h('div', { className: 'sc-mem-seg' }, options.map((option) => h('button', {
          type: 'button',
          key: String(option),
          className: memSame(option, draft) ? 'on' : '',
          disabled: !!reason || action.busy,
          onClick: () => setDraft(typeof field.value === 'number' ? Number(option) : option),
        }, String(option))));
      } else {
        editor = h('input', {
          className: 'sc-mem-input',
          value: draft === undefined || draft === null ? '' : String(draft),
          disabled: !!reason || action.busy,
          onChange: (e) => setDraft(typeof field.value === 'number' ? Number(e.target.value) : e.target.value),
        });
      }
      return h('div', { className: 'sc-mem-setrow' + (reason ? ' locked' : '') },
        h('div', { className: 'info' },
          h('div', { className: 'k' }, field.label || key,
            field.isDefault ? h('i', { className: 'tag' }, '默认') : null,
            field.group ? h('i', { className: 'tag grp' }, MEM_GROUP_LABEL[field.group] || field.group) : null),
          field.description ? h('div', { className: 'd' }, field.description) : null,
          field.cost ? h('div', { className: 'c' }, field.cost) : null,
          field.warning ? h('div', { className: 'w' }, field.warning) : null,
          reason ? h('div', { className: 'r' }, reason) : null),
        h('div', { className: 'ctl' }, editor,
          h('div', { className: 'row' },
            h('button', { className: 'sc-btn ghost', disabled, onClick: doSave }, action.busy ? '保存中…' : '保存'),
            dirty && !reason ? h('button', { className: 'sc-btn ghost', disabled: action.busy, onClick: () => setDraft(field.value) }, '撤销') : null),
          invalid ? h('div', { className: 'sc-mem-inline-err' }, invalid) : null,
          action.phase === 'success' ? h('div', { className: 'sc-mem-inline-ok' }, '已保存 · ' + fmtClock(action.at)) : null,
          action.error ? h(MemErrorBlock, {
            phase: action.error.notWired ? 'unavailable' : (action.phase === 'unknown' ? 'unknown' : 'failed'),
            error: action.error, compact: true, onRetry: blocked ? null : doSave,
          }) : null));
    }

    /* ── 记忆页：布局 + 顶部数据 + tab + 弹窗 ─────────────────────── */
    function MemoryPage(props) {
      const block = props.block || { name: '记忆', en: 'MEMORY' };
      const onBack = typeof props.onBack === 'function' ? props.onBack : () => {};
      const client = props.api || memApi;
      const [screen, setScreen] = useState('main');
      const [tab, setTab] = useState('vector');
      const [modeOpen, setModeOpen] = useState(false);
      const [activeJob, setActiveJob] = useState(null);
      const [modeConfirmed, setModeConfirmed] = useState(null);
      const overview = useMemoryLoad((signal) => client.overview(signal), []);
      const settings = useMemoryLoad((signal) => client.settings(signal), []);

      useEffect(() => {
        // 后端刷新回来的 mode 是权威值：一旦 overview 更新，就丢掉 POST 后的临时确认值
        setModeConfirmed(null);
      }, [overview.data]);

      if (screen === 'guide') return h(MemoryGuidePage, { onBack: () => setScreen('main') });

      const ov = overview.data;
      const controlAvailable = !!(ov && ov.controlAvailable === true);
      const capabilities = (ov && ov.capabilities && typeof ov.capabilities === 'object') ? ov.capabilities : null;
      const can = (key) => !!(ov && ov.controlAvailable === true && (!capabilities || capabilities[key] !== false));
      const mode = modeConfirmed || (ov && ov.mode) || null;
      const readPhase = overview.phase;
      const refreshAll = () => { overview.reload(); settings.reload(); };
      const badge = ov ? ('读取方式 · ' + memModeLabel(mode))
        : readPhase === 'unavailable' ? '后端待接入'
          : readPhase === 'unknown' ? '状态未知'
            : readPhase === 'failed' ? '读取失败'
              : readPhase === 'empty' ? '没有数据' : '读取中';

      return h('div', { className: 'sc-page sc-memory' },
        h('div', { className: 'top' },
          h('h2', { style: { color: 'hsl(205 95% 80%)' } }, block.name),
          h('span', { className: 'en' }, block.en),
          h('span', { className: 'sc-badge' }, badge)),
        h('div', { className: 'note' }, '两套记忆都正常存储；推荐向量记忆；', h('span', { style: { color: '#ff6b6b', fontWeight: 700 } }, '叙事记忆将在 SurfCore 1.0.0 下线')),

        h('div', { className: 'sc-mem-actions' },
          h('button', { className: 'sc-btn ghost', onClick: () => setScreen('guide') }, '使用说明'),
          h('button', {
            className: 'sc-btn',
            disabled: !can('mode'),
            title: can('mode') ? '接口：POST /surfcore-api/memory/mode' : (controlAvailable ? '后端未开启这个动作（capabilities.mode=false）' : '后端待接入：overview.controlAvailable=false'),
            onClick: () => setModeOpen(true),
          }, '记忆读取方式 · ' + (ov ? memModeLabel(mode) : '未知')),
          h('button', { className: 'sc-btn ghost', onClick: refreshAll, disabled: readPhase === 'loading' }, '刷新状态')),

        ov ? h('div', { className: 'sc-mem-toolbar' },
          h(MemSource, { phase: overview.phase, at: overview.at, note: 'GET /surfcore-api/memory/overview' }),
          h('span', { className: 'sc-spacer' }),
          ov.updatedAt ? h('span', { className: 'sc-mem-count' }, '后端更新于 ' + fmtClock(ov.updatedAt)) : null) : null,

        !ov && (readPhase === 'loading' || readPhase === 'loading-more')
          ? h(MemLoading, { label: '正在读取记忆状态…' })
          : null,
        !ov && readPhase !== 'loading' && readPhase !== 'loading-more'
          ? h('div', null,
            h(MemErrorBlock, { phase: readPhase, error: overview.error, onRetry: overview.reload, compact: true }),
            h('div', { className: 'sc-mem-banner warn' }, '后端待接入：下面是各面板的待接入状态，数据没读到，按钮全部禁用；页面不会读快照冒充实时。'),
            h(MemorySnapshotNote, { M: MEMORY, onRetry: overview.reload }))
          : null,

        ov && !controlAvailable ? h('div', { className: 'sc-mem-banner warn' }, '后端只读：overview.controlAvailable=false。写按钮全部禁用，页面不会假装保存成功。') : null,
        ov && Number(ov.vector?.records) > 0 && Number(ov.vector?.indexed) === 0
          ? h('div', { className: 'sc-mem-banner warn' }, '向量记忆已有 ' + ov.vector.records + ' 条记录，但已索引 0 条：Embedding 服务/索引还没跑起来。先到「向量记忆 → 总配置」启动服务并建索引，再切换读取方式；否则切过去也找不到旧事。')
          : null,

        h('div', { className: 'sc-mem-tabs' },
          h('button', { className: 'sc-mem-tab' + (tab === 'vector' ? ' on' : ''), onClick: () => setTab('vector') }, '向量记忆'),
          h('button', { className: 'sc-mem-tab' + (tab === 'narrative' ? ' on' : ''), onClick: () => setTab('narrative') }, '叙事记忆')),

        tab === 'narrative' ? h(NarrativePane, { api: client, overview: ov, controlAvailable }) : null,
        tab === 'vector' ? h(VectorPane, {
          api: client,
          overview: ov,
          controlAvailable,
          can,
          activeJob,
          onActiveJob: setActiveJob,
          onRefreshOverview: overview.reload,
        }) : null,

        h(MemorySettingsPanel, {
          api: client,
          resource: settings,
          overview: ov,
          controlAvailable,
          can,
          onChanged: refreshAll,
        }),

        modeOpen ? h(MemoryModeDialog, {
          api: client,
          current: mode,
          controlAvailable,
          capabilities,
          onClose: () => setModeOpen(false),
          onSaved: (next) => { setModeConfirmed(next); refreshAll(); setModeOpen(false); },
        }) : null,

        h('button', { className: 'sc-backlink', onClick: onBack }, '← 返回'));
    }

    /* ── 语音控制面：连接 / 模型 / 服务商 / 导入 / 试合成 ───────────── */
    function VoiceModelCard(props) {
      const m = props.model || {};
      const active = props.active === m.modelId;
      const state = String(m.state || 'missing');
      const tone = state === 'loaded' ? 'ok' : state === 'missing' ? 'warn' : 'off';
      const busy = props.busy === true;
      const act = (label, onClick, opts) => {
        const o = opts || {};
        return h('button', {
          className: 'sc-btn' + (o.ghost ? ' ghost' : ''),
          disabled: busy || o.disabled === true,
          title: o.title || '',
          onClick,
        }, label);
      };
      return h('div', { className: 'sc-voicec-card ' + (m.kind === 'cloud' ? 'cloud' : 'local') },
        h('div', { className: 'hd' },
          h('div', null,
            h('h3', null, m.label || m.modelId || '未命名模型'),
            h('div', { className: 'sub' }, voiceKindLabel(m.kind) + ' · ' + String(m.modelId || '—') + (m.voiceId ? ' · ' + m.voiceId : ''))),
          h('div', { className: 'badges' },
            h(MemPill, { tone }, voiceModelStateLabel(state)),
            active ? h(MemPill, { tone: 'ok' }, '当前') : null)),
        state === 'missing' ? h('div', { className: 'sc-voicec-warn' }, '模型记录在，但工件目录不在；需要导入模型工件，或选择改名/移动后的目录。') : null,
        h('div', { className: 'sc-voicec-actions' },
          state === 'missing' ? act('导入', () => props.onImport && props.onImport(m)) : null,
          state === 'missing' ? act('重新定位目录', () => props.onRelink && props.onRelink(m), { ghost: true, title: '选择改名/移动后的模型目录' }) : null,
          state !== 'missing' && state !== 'loaded' ? act('启动', () => props.onLoad(m)) : null,
          state === 'loaded' ? act('试合成', () => props.onTest(m)) : null,
          state !== 'missing' ? act('重新定位', () => props.onRelink && props.onRelink(m), { ghost: true, title: '选择改名/移动后的模型目录' }) : null,
          state === 'loaded' ? act('停止', () => props.onUnload(m), { ghost: true }) : null,
          !active ? act('设为当前', () => props.onSelect(m), { ghost: true }) : null));
    }

    function VoiceProviderPanel(props) {
      const providers = Array.isArray(props.providers) ? props.providers : [];
      const action = useMemoryAction();
      const emptyForm = () => ({
        id: 'cloud', kind: 'cloud', vendor: 'volcano',
        endpoint: 'http://127.0.0.1:8767', voiceId: 'age12-cloud',
        appId: '', accessKey: '', resourceId: 'seed-icl-2.0', speaker: '',
      });
      const [open, setOpen] = useState(false);
      const [editing, setEditing] = useState('');
      const [form, setForm] = useState(emptyForm());
      const [saveNotice, setSaveNotice] = useState(null);
      const current = providers.find((p) => p.id === editing) || null;
      const isVolcano = (p) => p && (p.vendor === 'volcano' || (!p.vendor && p.id === 'cloud'));
      const providerName = (p) => isVolcano(p) ? '火山引擎 · 声音复刻 2.0' : String(p.id || '服务商');
      const beginAdd = () => {
        const p = providers[0] || null;
        setEditing('');
        setForm(p ? {
          id: p.id, kind: 'cloud', vendor: p.vendor || 'volcano',
          endpoint: p.endpoint || 'http://127.0.0.1:8767', voiceId: p.voiceId || 'age12-cloud',
          appId: '', accessKey: '', resourceId: p.resourceId || 'seed-icl-2.0', speaker: p.speaker || '',
        } : emptyForm());
        setSaveNotice(null);
        setOpen(true);
      };
      const beginEdit = (p) => {
        setEditing(p.id);
        setForm({
          id: p.id, kind: 'cloud', vendor: p.vendor || 'volcano',
          endpoint: p.endpoint || 'http://127.0.0.1:8767', voiceId: p.voiceId || 'age12-cloud',
          appId: '', accessKey: '', resourceId: p.resourceId || 'seed-icl-2.0', speaker: p.speaker || '',
        });
        setSaveNotice(null);
        setOpen(true);
      };
      const set = (key, value) => setForm((prev) => Object.assign({}, prev, { [key]: value }));
      const save = () => {
        const body = {
          id: form.id.trim() || 'cloud',
          kind: 'cloud',
          vendor: 'volcano',
          endpoint: form.endpoint.trim(),
          voiceId: form.voiceId.trim() || 'age12-cloud',
          resourceId: form.resourceId.trim() || 'seed-icl-2.0',
          speaker: form.speaker.trim(),
        };
        if (form.appId.trim()) body.appId = form.appId.trim();
        if (form.accessKey.trim()) body.accessKey = form.accessKey.trim();
        action.run('保存火山引擎配置', () => voiceControlApi.saveProvider({ provider: body })).then((res) => {
          if (!res || !res.ok) return;
          setForm((prev) => Object.assign({}, prev, { appId: '', accessKey: '' }));
          if (props.onChanged) props.onChanged();
          const data = res.data || {};
          if (data.applied === false) {
            setSaveNotice({ tone: 'warn', text: '配置已保存，但还没应用到模型：' + String(data.applyError || '先导入/重新定位云端模型') });
          } else if (data.applied === true) {
            setSaveNotice({ tone: 'ok', text: '配置已写入 config.toml / voice.json，但当前 8767 仍在用旧配置；点上方「重启云端服务」才生效。' });
          } else {
            setSaveNotice({ tone: 'ok', text: '配置已保存。' });
          }
        });
      };
      const restartCloud = () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm('重启云端语音服务会中断当前云端语音；确定？')) return;
        const modelId = (providers[0] && providers[0].id) || 'cloud';
        setSaveNotice(null);
        action.run('重启云端语音服务', async () => {
          const stopped = await voiceControlApi.unload({ modelId });
          if (!stopped.ok) return stopped;
          return voiceControlApi.load({ modelId });
        }).then((res) => {
          if (props.onChanged) props.onChanged();
          if (res && res.ok) {
            setSaveNotice({ tone: 'ok', text: '云端服务已重启；新配置已加载。' });
          }
        });
      };
      const remove = (p) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('删除服务商 ' + p.id + '？保存的凭证也会删除。')) return;
        action.run('删除服务商', () => voiceControlApi.deleteProvider({ id: p.id })).then((res) => {
          if (res && res.ok && props.onChanged) props.onChanged();
        });
      };
      const consoleUrl = 'https://console.volcengine.com/speech/new/overview?projectName=default';
      const apiKeyUrl = 'https://console.volcengine.com/iam/keymanage/';
      return h('div', { className: 'sc-sect' },
        h('div', { className: 'sc-sect-hd' },
          h('h3', null, '服务商模型'),
          h('div', { className: 'sc-voicec-actions' },
            h('a', {
              className: 'sc-btn ghost', href: consoleUrl, target: '_blank', rel: 'noopener noreferrer',
              title: '打开火山引擎语音控制台，查 AppID / 音色复刻 ID',
            }, '打开火山引擎控制台'),
            providers.length ? h('button', { className: 'sc-btn ghost', onClick: restartCloud, disabled: action.busy }, action.busy ? '重启中…' : '重启云端服务') : null,
            providers.length
              ? h('button', { className: 'sc-btn', onClick: () => beginEdit(providers[0]) }, '配置火山引擎')
              : h('button', { className: 'sc-btn', onClick: beginAdd }, '添加火山引擎'))),
        h('div', { className: 'sc-voicec-note' }, '当前服务商：火山引擎 · 声音复刻 2.0（本地 voxd-cloud / 8767）。'),
        providers.length ? h('div', { className: 'sc-voicec-providers' },
          providers.map((p) => h('div', { key: p.id, className: 'sc-voicec-provider' },
            h('div', { className: 'hd' },
              h('b', null, providerName(p)),
              h(MemPill, { tone: p.configured ? 'ok' : 'warn' }, p.configured ? '已配置' : '未配置'),
              h('span', null, 'id ' + String(p.id))),
            h('div', { className: 'meta' },
              h('span', null, 'API ' + String(p.endpoint || '—')),
              h('span', null, 'AppID ' + (p.hasAppId ? String(p.appIdMasked || '已保存') : '未配置')),
              h('span', null, 'AccessKey ' + (p.hasAccessKey || p.hasKey ? String(p.accessKeyMasked || p.keyMasked || '已保存') : '未配置')),
              h('span', null, 'Resource ' + String(p.resourceId || '—')),
              h('span', null, '音色复刻 ' + String(p.speaker || '未配置'))),
            h('div', { className: 'sc-voicec-actions' },
              h('button', { className: 'sc-btn ghost', onClick: () => beginEdit(p) }, '配置'),
              h('button', { className: 'sc-btn danger', onClick: () => remove(p), disabled: action.busy }, '删除'))))) : h('div', { className: 'sc-voicec-note' }, '还没有服务商；云端模型需要先添加火山引擎配置。'),
        saveNotice ? h('div', { className: 'sc-voicec-notice ' + (saveNotice.tone === 'ok' ? 'ok' : 'err') },
          saveNotice.text,
          h('button', { className: 'sc-btn ghost', onClick: () => setSaveNotice(null) }, '关闭')) : null,
        open ? h('div', { className: 'sc-voicec-form' },
          h('label', { className: 'sc-voicec-field' }, h('span', null, 'API / Endpoint'), h('input', { className: 'sc-mem-input', value: form.endpoint, onChange: (e) => set('endpoint', e.target.value), disabled: action.busy })),
          h('label', { className: 'sc-voicec-field' }, h('span', null, 'AppID'), h('input', { className: 'sc-mem-input', value: form.appId, placeholder: current && current.hasAppId ? '已保存 ' + String(current.appIdMasked || '') + '（留空保留）' : '火山引擎 AppID', onChange: (e) => set('appId', e.target.value), disabled: action.busy })),
          h('label', { className: 'sc-voicec-field' }, h('span', null, 'AccessKey'), h('input', { className: 'sc-mem-input', type: 'password', value: form.accessKey, placeholder: current && (current.hasAccessKey || current.hasKey) ? '已保存 ' + String(current.accessKeyMasked || current.keyMasked || '') + '（留空保留）' : '火山引擎 AccessKey', onChange: (e) => set('accessKey', e.target.value), disabled: action.busy })),
          h('label', { className: 'sc-voicec-field' }, h('span', null, 'Resource ID'), h('input', { className: 'sc-mem-input', value: form.resourceId, onChange: (e) => set('resourceId', e.target.value), disabled: action.busy })),
          h('label', { className: 'sc-voicec-field' }, h('span', null, '音色复刻 ID（speaker）'), h('input', { className: 'sc-mem-input', value: form.speaker, placeholder: '火山声音复刻 ID，不是 age12-cloud', onChange: (e) => set('speaker', e.target.value), disabled: action.busy })),
          h('div', { className: 'sc-voicec-actions' },
            h('button', { className: 'sc-btn', onClick: save, disabled: action.busy || !form.endpoint.trim() }, action.busy ? '保存中…' : '保存配置')),
          action.error ? h(MemErrorBlock, { phase: action.phase, error: action.error, onRetry: save }) : null,
          h('div', { className: 'sc-voicec-note' }, '保存不会立即生效：8767 启动时读取 config.toml / voice.json。保存后点「重启云端服务」，或停止再启动云端模型。'),
          h('div', { className: 'sc-voicec-note' },
            '去哪找：',
            h('a', { href: consoleUrl, target: '_blank', rel: 'noopener noreferrer' }, '火山引擎语音控制台'),
            '（AppID / 音色复刻 ID） · ',
            h('a', { href: apiKeyUrl, target: '_blank', rel: 'noopener noreferrer' }, 'API Key 管理'),
            '（AccessKey）')) : null);
    }

    function VoiceRelinkDialog(props) {
      const model = props.model || null;
      const action = useMemoryAction();
      const [dir, setDir] = useState('');
      const [browseError, setBrowseError] = useState(null);
      const [picking, setPicking] = useState(false);
      useEffect(() => {
        setDir('');
        setBrowseError(null);
        setPicking(false);
      }, [model]);
      const pick = async () => {
        setPicking(true);
        setBrowseError(null);
        const res = await browseLocalPath({ mode: 'dir', title: '选择改名/移动后的模型目录' });
        setPicking(false);
        if (res && res.ok) { setDir(res.path); return; }
        if (res && res.cancelled) return;
        setBrowseError(res && res.error ? res.error : voiceControlErr('VOICE_BROWSE_FAILED', '系统文件选择器不可用', '重试或换一个位置'));
      };
      const submit = () => {
        if (!model || !dir.trim()) return;
        action.run('重新定位模型目录', () => voiceControlApi.relink({ modelId: model.modelId, dir: dir.trim() })).then((res) => {
          if (res && res.ok && props.onChanged) props.onChanged();
        });
      };
      const result = action.phase === 'success' ? action.data : null;
      const busy = action.busy;
      return h('div', { className: 'sc-modal-mask', onClick: busy ? null : props.onClose },
        h('div', { className: 'sc-modal sc-voicec-modal', onClick: (e) => e.stopPropagation() },
          h('h3', null, model ? '重新定位 ' + (model.label || model.modelId) : '重新定位模型目录'),
          h('div', { className: 'sub' }, '只更新目录指针，不复制、不移动文件；会校验 manifest 和文件哈希。'),
          model ? h('div', { className: 'sc-voicec-note' }, '模型标识：' + String(model.modelId) + ' · ' + voiceKindLabel(model.kind)) : null,
          model && model.state === 'loaded' ? h('div', { className: 'sc-voicec-warn' }, '当前已启动；重新定位只改目录，需要停止再启动后才会使用新目录。') : null,
          model ? h('label', { className: 'sc-voicec-field' },
            h('span', null, '模型目录'),
            h('div', { className: 'sc-voicec-pickrow' },
              h('input', { className: 'sc-mem-input', readOnly: true, value: dir, placeholder: '点右侧按钮选择目录', disabled: busy }),
              h('button', { className: 'sc-btn ghost', onClick: pick, disabled: busy || picking }, picking ? '选择中…' : '选择目录'))) : null,
          browseError ? h('div', { className: 'sc-voicec-notice err' },
            h('span', null, String(browseError.message || '选择失败') + ' · ' + String(browseError.hint || '重试')),
            h('button', { className: 'sc-btn ghost', onClick: () => setBrowseError(null) }, '关闭')) : null,
          h('div', { className: 'sc-voicec-note' }, '只对现有模型记录重新关联目录；不会新建模型。'),
          busy ? h(MemLoading, { label: '正在校验目录和哈希…' }) : null,
          action.error ? h(MemErrorBlock, { phase: action.phase, error: action.error, onRetry: submit }) : null,
          result ? h('div', { className: 'sc-voicec-note' }, '已重新定位；模型状态已刷新。') : null,
          h('div', { className: 'sc-modal-actions' },
            h('button', { className: 'sc-btn ghost', onClick: props.onClose, disabled: busy }, '关闭'),
            h('button', { className: 'sc-btn', onClick: submit, disabled: !model || busy || !dir.trim() }, busy ? '校验中…' : '确认重新定位'))));
    }

    function VoiceImportDialog(props) {
      const seed = props.seed || null;
      const action = useMemoryAction();
      const [form, setForm] = useState({ sourceDir: '', targetDir: '' });
      const [browseError, setBrowseError] = useState(null);
      const [picking, setPicking] = useState('');
      const [deleteSource, setDeleteSource] = useState(false);
      const [force, setForce] = useState(false);
      useEffect(() => {
        setForm({ sourceDir: '', targetDir: '' });
        setBrowseError(null);
        setDeleteSource(false);
        setForce(false);
      }, [seed]);
      const set = (key, value) => setForm((prev) => Object.assign({}, prev, { [key]: value }));
      const expectedZip = seed && seed.kind === 'cloud'
        ? 'voice-cloud-offline-v1.0.0-win-x64.zip'
        : 'voice-local-offline-v1.0.0-win-x64.zip';
      const modelDirName = String(seed && seed.modelId ? seed.modelId : 'model').replace(/[^A-Za-z0-9._-]+/g, '_');
      const targetRoot = form.targetDir.trim().replace(/[\\/]+$/, '');
      const targetDir = targetRoot ? targetRoot + '\\' + modelDirName : '';
      const pick = async (mode, field, title) => {
        setPicking(field);
        setBrowseError(null);
        const res = await browseLocalPath({ mode, title });
        setPicking('');
        if (res && res.ok) {
          set(field, res.path);
          if (field === 'targetDir') setForce(false);
          return;
        }
        if (res && res.cancelled) return;
        setBrowseError(res && res.error ? res.error : voiceControlErr('VOICE_BROWSE_FAILED', '系统文件选择器不可用', '重试或换一个位置'));
      };
      const submit = (forceOverride) => {
        if (!seed) return;
        if (deleteSource && typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm('导入成功后会删除原 .zip，无法恢复。确定？')) return;
        const payload = {
          sourceDir: form.sourceDir.trim(),
          targetDir,
          force: forceOverride === true || force,
          deleteSource: deleteSource === true,
          model: { id: seed.modelId, kind: seed.kind === 'cloud' ? 'cloud' : 'local', voiceId: seed.voiceId || '', label: seed.label || '' },
        };
        action.run('导入模型工件', () => voiceControlApi.importModel({ payload })).then((res) => {
          if (!res || !res.ok) return;
          setForce(false);
          if (res.data && res.data.sourceDeleted === true) {
            setForm((prev) => Object.assign({}, prev, { sourceDir: '' }));
          }
          if (props.onChanged) props.onChanged();
        });
      };
      const result = action.phase === 'success' ? action.data : null;
      const busy = action.busy;
      const sourceIsZip = /\.zip$/i.test(form.sourceDir);
      const targetExists = action.error && action.error.code === 'voice-model.target-exists';
      return h('div', { className: 'sc-modal-mask', onClick: busy ? null : props.onClose },
        h('div', { className: 'sc-modal sc-voicec-modal', onClick: (e) => e.stopPropagation() },
          h('h3', null, seed ? '导入 ' + (seed.label || seed.modelId) : '导入模型'),
          seed ? h('div', { className: 'sub' }, '选择官方模型 .zip，安装到本地目录。模型标识已由卡片带过来，不需要再填。') : null,
          seed ? h('div', { className: 'sc-voicec-note' }, '将导入：' + String(seed.label || seed.modelId) + ' · ' + String(seed.modelId) + ' · ' + voiceKindLabel(seed.kind) + (seed.voiceId ? ' · ' + seed.voiceId : '')) : null,
          seed ? h('label', { className: 'sc-voicec-field' },
            h('span', null, '模型文件'),
            h('div', { className: 'sc-voicec-pickrow' },
              h('input', { className: 'sc-mem-input', readOnly: true, value: form.sourceDir, placeholder: '点右侧按钮选择 .zip', disabled: busy }),
              h('button', { className: 'sc-btn ghost', onClick: () => pick('file', 'sourceDir', '选择语音模型 .zip'), disabled: busy || !!picking }, picking === 'sourceDir' ? '选择中…' : '选择 .zip')),
            h('div', { className: 'sc-voicec-note' }, '建议选择：' + expectedZip)) : null,
          seed ? h('label', { className: 'sc-voicec-field' },
            h('span', null, '安装根目录'),
            h('div', { className: 'sc-voicec-pickrow' },
              h('input', { className: 'sc-mem-input', readOnly: true, value: form.targetDir, placeholder: '点右侧按钮选择安装根目录', disabled: busy }),
              h('button', { className: 'sc-btn ghost', onClick: () => pick('dir', 'targetDir', '选择模型安装根目录'), disabled: busy || !!picking }, picking === 'targetDir' ? '选择中…' : '选择目录')),
            h('div', { className: 'sc-voicec-note' }, targetDir ? '实际安装到：' + targetDir + '（自动建模型子目录，不污染根目录）' : '会为模型自动建独立子目录，不直接铺在根目录。')) : null,
          browseError ? h('div', { className: 'sc-voicec-notice err' },
            h('span', null, String(browseError.message || '选择失败') + ' · ' + String(browseError.hint || '重试')),
            h('button', { className: 'sc-btn ghost', onClick: () => setBrowseError(null) }, '关闭')) : null,
          seed ? h('label', { className: 'sc-voicec-checkline' },
            h('input', { type: 'checkbox', checked: deleteSource, disabled: busy || !sourceIsZip, onChange: (e) => setDeleteSource(e.target.checked) }),
            '导入成功后删除原 .zip（不可恢复）') : null,
          seed ? h('div', { className: 'sc-voicec-note' }, '只在导入成功后删除；删除失败不影响安装。') : null,
          seed ? h('div', { className: 'sc-voicec-note' }, '后端是同步长请求，没有进度接口；提交后不要重复点，不要关闭页面。') : h('div', { className: 'sc-voicec-warn' }, '缺少模型标识；请从模型卡片的「导入」进入。'),
          busy ? h(MemLoading, { label: '正在导入，可能数分钟…' }) : null,
          action.error ? h(MemErrorBlock, { phase: action.phase, error: action.error, onRetry: submit }) : null,
          targetExists ? h('div', { className: 'sc-voicec-warn' },
            h('div', null, '安装目录已有内容。覆盖会删除该目录后再导入。'),
            h('button', {
              className: 'sc-btn danger',
              onClick: () => {
                if (typeof window !== 'undefined' && typeof window.confirm === 'function'
                  && !window.confirm('覆盖会删除安装目录现有内容，确定？')) return;
                setForce(true);
                submit(true);
              },
            }, '覆盖并重试')) : null,
          result ? h('div', { className: 'sc-voicec-note' }, result.sourceDeleted === true
            ? '导入成功；原 .zip 已删除。'
            : result.sourceDeleted === false && result.sourceDeleteError
              ? '导入成功；但原 .zip 删除失败：' + String(result.sourceDeleteError)
              : '导入成功；后端模型状态已刷新。') : null,
          h('div', { className: 'sc-modal-actions' },
            h('button', { className: 'sc-btn ghost', onClick: props.onClose, disabled: busy }, '关闭'),
            h('button', { className: 'sc-btn', onClick: submit, disabled: !seed || busy || !form.sourceDir.trim() || !form.targetDir.trim() }, busy ? '导入中…' : '开始导入'))));
    }

    function VoiceSynthDialog(props) {
      const action = useMemoryAction();
      const [text, setText] = useState('你好呀，语音模型已经装好了。');
      const [playing, setPlaying] = useState(false);
      const [playError, setPlayError] = useState('');
      const audioRef = useRef(null);
      const urlRef = useRef('');
      const result = action.phase === 'success' ? action.data : null;
      const audioData = result && result.bytes && Array.isArray(result.bytes.data) ? result.bytes.data : null;
      const byteCount = audioData ? audioData.length : (result && typeof result.bytes === 'number' ? result.bytes : null);
      const stopAudio = () => {
        const audio = audioRef.current;
        if (audio) { try { audio.pause(); } catch (error) { /* 忽略 */ } }
        setPlaying(false);
      };
      const cleanupAudio = () => {
        stopAudio();
        if (urlRef.current) {
          try { URL.revokeObjectURL(urlRef.current); } catch (error) { /* 忽略 */ }
          urlRef.current = '';
        }
        audioRef.current = null;
      };
      useEffect(() => () => cleanupAudio(), []);
      const run = () => {
        if (!text.trim()) return;
        cleanupAudio();
        setPlayError('');
        action.run('试合成', () => voiceControlApi.probe({ modelId: props.model.modelId, text: text.trim() }));
      };
      const play = () => {
        if (!audioData || !audioData.length) { setPlayError('后端没有返回可播放的音频数据'); return; }
        cleanupAudio();
        try {
          const blob = new Blob([new Uint8Array(audioData)], { type: 'audio/wav' });
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => setPlaying(false);
          audio.onerror = () => { setPlaying(false); setPlayError('音频播放失败'); };
          const p = audio.play();
          if (p && typeof p.catch === 'function') p.catch(() => { setPlaying(false); setPlayError('浏览器拒绝了播放，请再点一次'); });
          setPlaying(true);
          setPlayError('');
        } catch (error) {
          setPlaying(false);
          setPlayError('无法创建音频播放：' + String(error && error.message ? error.message : error));
        }
      };
      return h('div', { className: 'sc-modal-mask', onClick: action.busy ? null : () => { cleanupAudio(); props.onClose(); } },
        h('div', { className: 'sc-modal', onClick: (e) => e.stopPropagation() },
          h('h3', null, '试合成 · 不发消息'),
          h('div', { className: 'sub' }, String(props.model.label || props.model.modelId) + '：只在本机试听，不发送到任何聊天。'),
          props.model.kind === 'local' ? h('div', { className: 'sc-voicec-warn' }, '本地音色引擎启动后通常还要 1–3 分钟加载；刚启动就试合成会失败，请稍等再试。') : null,
          h('label', { className: 'sc-voicec-field' }, h('span', null, '文本'), h('input', { className: 'sc-mem-input', value: text, maxLength: 200, disabled: action.busy, onChange: (e) => setText(e.target.value) })),
          h('div', { className: 'sc-voicec-note' }, audioData ? '后端返回了音频数据；点「播放试音」在本机播放。' : '合成后返回字节/时长；如果后端没有带音频数据，播放按钮会禁用。'),
          action.busy ? h(MemLoading, { label: '正在合成…' }) : null,
          action.error ? h(MemErrorBlock, { phase: action.phase, error: action.error, onRetry: run }) : null,
          playError ? h('div', { className: 'sc-voicec-warn' }, playError) : null,
          result ? h('div', { className: 'sc-voicec-result' },
            h('span', null, '字节 ' + String(byteCount != null ? byteCount : '?')),
            h('span', null, '时长 ' + (result.durationMs != null ? String(result.durationMs) + ' ms' : '?'))) : null,
          h('div', { className: 'sc-modal-actions' },
            h('button', { className: 'sc-btn ghost', onClick: () => { cleanupAudio(); props.onClose(); }, disabled: action.busy }, '关闭'),
            h('button', { className: 'sc-btn', onClick: playing ? stopAudio : play, disabled: action.busy || !audioData }, playing ? '停止播放' : '播放试音'),
            h('button', { className: 'sc-btn', onClick: run, disabled: action.busy || !text.trim() }, action.busy ? '合成中…' : '开始试合成'))));
    }

    function VoiceControlPage(props) {
      const statusRes = useMemoryLoad((signal) => voiceControlApi.status({ signal }), []);
      const action = useMemoryAction();
      const [notice, setNotice] = useState(null);
      const [testModel, setTestModel] = useState(null);
      const [importSeed, setImportSeed] = useState(null);
      const [importOpen, setImportOpen] = useState(false);
      const [relinkTarget, setRelinkTarget] = useState(null);
      const [relinkOpen, setRelinkOpen] = useState(false);
      const aliveRef = useRef(true);
      useEffect(() => () => { aliveRef.current = false; }, []);
      const models = statusRes.data && Array.isArray(statusRes.data.models) ? statusRes.data.models : [];
      const providers = statusRes.data && Array.isArray(statusRes.data.providers) ? statusRes.data.providers : [];
      const active = statusRes.data && statusRes.data.active ? String(statusRes.data.active) : '';
      const activeModel = models.find((m) => m.modelId === active) || null;
      const loadedModels = models.filter((m) => m.state === 'loaded');
      const reload = () => statusRes.reload();
      const runModel = (label, fn, successText) => {
        setNotice(null);
        return action.run(label, fn).then((res) => {
          if (res && res.ok) {
            if (aliveRef.current) setNotice({ tone: 'ok', text: successText || (label + '完成') });
            statusRes.reload();
          }
          return res;
        });
      };
      const loadModel = async (m) => {
        const others = loadedModels.filter((x) => x.modelId !== m.modelId);
        if (others.length && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          const names = others.map((x) => x.label || x.modelId).join('、');
          if (!window.confirm('语音模型互斥：启动 ' + (m.label || m.modelId) + ' 会先停止 ' + names + '。继续？')) return;
        }
        setNotice(null);
        const res = await action.run('启动 ' + (m.label || m.modelId), async () => {
          for (const other of others) {
            const stopped = await voiceControlApi.unload({ modelId: other.modelId });
            if (!stopped.ok) return stopped;
          }
          const loaded = await voiceControlApi.load({ modelId: m.modelId });
          if (!loaded.ok) return loaded;
          return voiceControlApi.select({ modelId: m.modelId });
        });
        statusRes.reload();
        if (res && res.ok && aliveRef.current) setNotice({ tone: 'ok', text: '已启动并切换为当前模型。本地音色引擎可能还需 1–3 分钟加载，期间试合成会失败。' });
        return res;
      };
      const unloadModel = (m) => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('停止会关闭这个模型服务；确定？')) return;
        runModel('停止 ' + (m.label || m.modelId), () => voiceControlApi.unload({ modelId: m.modelId }), '已停止。');
      };
      const selectModel = (m) => runModel('设为当前：' + (m.label || m.modelId), () => voiceControlApi.select({ modelId: m.modelId }), '已切换当前模型。');
      const enforceSingle = () => {
        if (loadedModels.length < 2) return;
        const keep = loadedModels.find((x) => x.modelId === active) || loadedModels[0];
        const drop = loadedModels.filter((x) => x.modelId !== keep.modelId);
        if (!drop.length) return;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm('只保留 ' + (keep.label || keep.modelId) + '，停止 ' + drop.map((x) => x.label || x.modelId).join('、') + '？')) return;
        setNotice(null);
        action.run('停止其他模型', async () => {
          for (const item of drop) {
            const stopped = await voiceControlApi.unload({ modelId: item.modelId });
            if (!stopped.ok) return stopped;
          }
          return { ok: true };
        }).then((res) => {
          statusRes.reload();
          if (res && res.ok && aliveRef.current) setNotice({ tone: 'ok', text: '已只保留当前模型。' });
          return res;
        });
      };
      const onChanged = () => statusRes.reload();
      const openImport = (seed) => { if (!seed) return; setImportSeed(seed); setImportOpen(true); };
      const openRelink = (model) => { if (!model) return; setRelinkTarget(model); setRelinkOpen(true); };
      const badgeText = statusRes.data ? '已连接' : statusRes.phase === 'loading' ? '连接中' : '未连接';
      const badgeTone = statusRes.data ? 'ok' : statusRes.phase === 'loading' ? 'warn' : 'warn';

      const header = h('div', { className: 'top' },
        h('h2', { style: { color: 'hsl(' + String((props.block && props.block.hue) || 190) + ' 95% 80%)' } }, (props.block && props.block.name) || '语音'),
        h('span', { className: 'en' }, (props.block && props.block.en) || 'VOICE'),
        h(MemPill, { tone: badgeTone }, badgeText),
        h('span', { className: 'sc-spacer' }),
        h(MemSource, { phase: statusRes.phase, at: statusRes.at, note: '/surfcore-api/voice' }),
        h('button', { className: 'sc-btn ghost', onClick: reload, disabled: statusRes.phase === 'loading' }, '刷新'));
      const shell = (body) => h('div', { className: 'sc-page' }, header, body, h('button', { className: 'sc-backlink', onClick: props.onBack }, '← 返回'));

      if (statusRes.phase === 'loading' && !statusRes.data) return shell(h(MemLoading, { label: '正在读取语音控制面…' }));
      if (!statusRes.data && statusRes.error) {
        const e = statusRes.error;
        const serviceUnavailable = e.code === 'VOICE_CONTROL_UNAVAILABLE';
        return shell(h('div', null,
          serviceUnavailable ? h('div', { className: 'sc-voicec-unavailable' },
            h('b', null, '语音服务还未就绪'),
            h('div', { className: 'sc-voicec-note' }, e.message || '语音服务暂时不可用'),
            h('div', { className: 'sc-voicec-note' }, e.hint || '稍后重试；如果持续这样，请联系管理员'),
            h('div', { className: 'sc-voicec-actions' }, h('button', { className: 'sc-btn', onClick: reload }, '重试')))
            : h(MemErrorBlock, { phase: statusRes.phase, error: e, onRetry: reload }),
          h('div', { className: 'sc-voicec-note' }, '语音服务由宿主自动管理；不需要用户配置地址或令牌。')));
      }
      if (!statusRes.data) return shell(h('div', { className: 'sc-voicec-empty' }, '控制面没有返回状态；点刷新重试。'));

      return shell(h('div', null,
        h('div', { className: 'sc-voicec-status' },
          h('div', { className: 'hd' },
            h('b', null, activeModel ? '当前：' + (activeModel.label || activeModel.modelId) : '当前未选择模型'),
            h(MemPill, { tone: activeModel && activeModel.state === 'loaded' ? 'ok' : 'off' }, activeModel ? voiceModelStateLabel(activeModel.state) : '未选择')),
          h('div', { className: 'meta' }, '模型 ' + models.length + ' · 服务商 ' + providers.length + ' · 同源 /surfcore-api/voice')),
        notice ? h('div', { className: 'sc-voicec-notice ok' }, notice.text, h('button', { className: 'sc-btn ghost', onClick: () => setNotice(null) }, '关闭')) : null,
        loadedModels.length > 1 ? h('div', { className: 'sc-voicec-warn' },
          h('div', null, '检测到 ' + loadedModels.length + ' 个模型同时启动；语音模型应互斥，只保留一个。'),
          h('button', { className: 'sc-btn danger', onClick: enforceSingle }, '只保留当前模型')) : null,
        action.error ? h('div', { className: 'sc-voicec-notice err' }, h(MemErrorBlock, { phase: action.phase, error: action.error, onRetry: action.reset, retryLabel: '关闭' })) : null,
        statusRes.error && statusRes.data ? h('div', { className: 'sc-voicec-notice err' }, h(MemErrorBlock, { phase: statusRes.phase, error: statusRes.error, compact: true, onRetry: reload })) : null,
        h('div', { className: 'sc-sect' },
          h('div', { className: 'sc-sect-hd' }, h('h3', null, '模型')),
          models.length ? h('div', { className: 'sc-voicec-grid' }, models.map((m) => h(VoiceModelCard, {
            key: m.modelId, model: m, active, busy: action.busy,
            onLoad: loadModel, onUnload: unloadModel, onSelect: selectModel, onTest: setTestModel, onImport: openImport, onRelink: openRelink,
          }))) : h('div', { className: 'sc-voicec-empty' }, '后端还没有模型记录。')),
        h(VoiceProviderPanel, { providers, onChanged }),
        testModel ? h(VoiceSynthDialog, { model: testModel, onClose: () => setTestModel(null) }) : null,
        importOpen && importSeed ? h(VoiceImportDialog, { seed: importSeed, onClose: () => setImportOpen(false), onChanged }) : null,
        relinkOpen && relinkTarget ? h(VoiceRelinkDialog, { model: relinkTarget, onClose: () => setRelinkOpen(false), onChanged }) : null));
    }

    /* 区块页（真数据：能力 + 设置） */
    function BlockPage(props) {
      const { block, onBack } = props;
      if (block.id === 'memory') return h(MemoryPage, { block, onBack });
      if (block.id === 'voice') return h(VoiceControlPage, { block, onBack });
      const caps = capOf(block.id);
      const sets = settingsOf(block.id);
      const done = caps.filter((c) => c.status === 'done').length;
      return h('div', { className: 'sc-page' },
        h('div', { className: 'top' },
          h('h2', { style: { color: `hsl(${block.hue} 95% 80%)` } }, block.name),
          h('span', { className: 'en' }, block.en),
          h('span', { className: 'sc-badge' }, `${done}/${caps.length} 已做`)),
        h('div', { className: 'note' }, block.note),

        h('div', { className: 'sc-sect' },
          h('h3', null, '它能做什么'),
          caps.length ? h('div', { className: 'sc-caps' },
            caps.map((c, i) => h('div', { key: `${c.name}-${i}`, className: `sc-cap ${c.status}` },
              h('span', { className: 'd' }),
              h('div', null, c.name, c.evidence ? h('span', { className: 'ev' }, c.evidence) : null))),
          ) : h('div', { className: 'sc-empty' }, '（这一块还没有登记能力）')),

        h('div', { className: 'sc-sect' },
          h('h3', null, '可调设置'),
          sets.length ? h('div', { className: 'sc-set' },
            sets.map((s) => h('div', { key: s.key, className: 'sc-item' },
              h('div', { className: 'k' }, s.label),
              h('div', { className: 'v' }, String(s.value), s.isDefault ? h('small', null, '默认') : h('small', null, '已改')),
              s.options.length ? h('div', { className: 'o' },
                s.options.map((o) => h('span', { key: String(o), className: o === s.value ? 'cur' : '' }, String(o)))) : null,
              h('div', { className: 'c' }, s.cost))))
          : h('div', { className: 'sc-empty' }, '这一块暂时没有可调项（设置项在「设置」里）')),

        h('button', { className: 'sc-backlink', onClick: onBack }, '← 返回'),
      );
    }

    /* ┢�┢� 组页：一个入口下的区块（意识/记忆/感官/其他） ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function GroupPage(props) {
      const { group, onOpen, onBack } = props;
      const blocks = group.blocks.map((id) => BLOCKS.find((b) => b.id === id)).filter(Boolean);
      const caps = blocks.reduce((n, b) => n + capOf(b.id).length, 0);
      return h('div', { className: 'sc-page' },
        h('div', { className: 'top' },
          h('h2', { style: { color: `hsl(${group.hue} 95% 80%)` } }, group.name),
          h('span', { className: 'en' }, group.en),
          h('span', { className: 'sc-badge' }, `${blocks.length} 块 · ${caps} 项`)),
        group.id === 'other' ? null : h('div', { className: 'note' }, group.note),
        h('div', { className: 'sc-group-grid' },
          blocks.map((bk) => h('button', {
            key: bk.id, className: 'sc-subblock', onClick: () => onOpen(bk.id), title: bk.note,
          },
            h('span', { className: 'nm' }, bk.name),
            h('span', { className: 'en' }, bk.en),
            h('span', { className: 'ct' }, capOf(bk.id).length + ' 项')))),
        h('div', { className: 'sc-group-note' }, '同一套四段：这里只是区块入口，点进去才是该块的能力/设置。'),
        h('button', { className: 'sc-backlink', onClick: onBack }, '← 返回'),
      );
    }

    /* ┢�┢� 星环：��配�?┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function Galaxy(props) {
      const { adapters, meta, onOpen } = props;
      const canvasRef = useRef(null);
      useStars(canvasRef);
      const nodesRef = useRef([]);
      const [hovered, setHovered] = useState(null);
      const hoveredRef = useRef(null);
      hoveredRef.current = hovered;

      useEffect(() => {
        let raf = 0; let stopped = false;
        let last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let elapsed = 0;
        const loop = () => {
          if (stopped) return;
          const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
          last = nowMs;
          elapsed += dt * (hoveredRef.current ? 0.18 : 1);
          const el = nodesRef.current;
          for (let i = 0; i < adapters.length; i += 1) {
            const node = el[i];
            if (!node) continue;
            let laneIdx = 0;
            let idxInLane = i;
            while (laneIdx < LANES.length - 1 && idxInLane >= LANES[laneIdx].cap) {
              idxInLane -= LANES[laneIdx].cap;
              laneIdx += 1;
            }
            const lane = LANES[laneIdx];
            const base = (idxInLane / lane.cap) * Math.PI * 2;
            const angle = base + (elapsed / lane.periodSec) * Math.PI * 2 * lane.dir;
            node.style.left = `${50 + (Math.cos(angle) * lane.r / 560) * 100}%`;
            node.style.top = `${50 + (Math.sin(angle) * lane.r / 560) * 100}%`;
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => { stopped = true; cancelAnimationFrame(raf); };
      }, [adapters.length]);   /* 只认数量：数组每次渲染都是新引用，会把计时器重置�?0 */

      const laneSizes = LANES.map((l) => `${(l.r / 560) * 200}%`);

      return h('div', { className: 'sc-galaxy' },
        h('canvas', { ref: canvasRef, style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }),
        h('div', { className: 'sc-neb' }),
        h('div', { className: 'sc-dust' }),
        LANES.map((l, i) => h('div', {
          key: `lane-${i}`,
          className: `sc-lane${i === 0 ? ' solid' : ''}`,
          style: { width: laneSizes[i], height: laneSizes[i], animation: `sc-spin ${l.periodSec}s linear infinite ${i % 2 ? 'reverse' : ''}` },
        })),
        h('div', { className: 'sc-core-adapt' },
          h('div', { className: 'ring' }),
          h('div', { className: 'big' }, '大适配器'),
          h('div', { className: 'sub' }, 'BIG ADAPTER'),
          h('div', { className: 'note' }, `接手 ${adapters.length} 个小适配器 · 协议 v${meta.protocol}`),
          h('div', { className: 'sub', style: { marginTop: 8 } }, `已启用 ${adapters.filter((a) => a.enabled).length}/${adapters.length}`)),
        adapters.map((a, i) => h('div', {
          key: a.id,
          ref: (el) => { nodesRef.current[i] = el; },
          className: `sc-node${a.enabled ? '' : ' off'}`,
          onMouseEnter: () => setHovered(a.id),
          onMouseLeave: () => setHovered(null),
          onClick: () => onOpen(a.id),
          title: `${a.name} v${a.version}`,
        },
          h('span', { className: 'sc-o' }),
          h('span', { className: 'sc-nm' }, h('b', null, a.name), h('i', null, `v${a.version}`)))),
        hovered ? (() => {
          const a = adapters.find((x) => x.id === hovered);
          if (!a) return null;
          return h('div', { className: 'sc-card' },
            h('h4', null, a.name),
            h('div', { className: 'kv' }, h('span', null, '发布人'), h('b', null, a.publisher)),
            h('div', { className: 'kv' }, h('span', null, '版本'), h('b', null, `v${a.version}`)),
            h('div', { className: 'kv' }, h('span', null, '协议'), h('b', null, `v${a.protocol}`)),
            h('div', { className: 'kv' }, h('span', null, '信任'), h('b', null, (a.trust || []).join(', ') || '—')),
            h('div', { className: 'kv' }, h('span', null, '状态'), h('b', null, a.enabled ? '已启用' : '未启用')),
            h('button', { className: 'go', onClick: () => onOpen(a.id) }, '进入模块 →'));
        })() : null,
        h('div', { className: 'sc-legend' },
          h('div', null, h('i'), '已启用'),
          h('div', null, h('i', { className: 'off' }), '未启用'),
          h('div', null, `轨道容量 ${LANE_TOTAL} 位（3 圈）· 更多自动进外层星团`)),
      );
    }

    /* ┢�┢� 扩展栏：可展弢�/收起；导�?zip；加�?收回轨道 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function Rail(props) {
      const {
        open, onToggle, packs, imports, hidden, onToggleHidden,
        picked, onPick, onCopy, toast,
      } = props;
      const fileRef = useRef(null);

      const row = (key, name, meta, badge, hiddenNow, actionLabel, onAct, warn) => h('div', {
        key,
        className: 'sc-item' + (hiddenNow ? ' off' : ''),
      },
        h('div', { className: 'col' },
          h('div', { className: 'nm' }, name),
          h('div', { className: 'mt' }, meta),
          badge ? h('span', { className: 'badge' }, badge) : null),
        h('button', {
          className: 'act' + (warn ? ' warn' : ''),
          onClick: onAct,
        }, actionLabel));

      const rows = [];

      /* 待导入：用户刚��的 / imports/ 目录里已有的 */
      picked.forEach((f) => {
        rows.push(row('picked-' + f.name, f.name, Math.max(1, Math.round(f.bytes / 1024)) + ' KB · 刚选择', '待导入',
          false, '复制命令', () => onCopy(f.name, 'picked'), false));
      });
      imports.forEach((f) => {
        if (picked.some((x) => x.name === f.file)) return;
        rows.push(row('zip-' + f.file, f.file, f.at + ' · imports/', '待导入',
          false, '复制命令', () => onCopy(f.file, 'zip'), false));
      });

      /* 已安装的包 */
      packs.forEach((a) => {
        const isHidden = hidden.includes(a.id);
        rows.push(row('pack-' + a.id, a.name, 'v' + a.version + ' · ' + a.publisher,
          a.enabled ? '已启用' : '未启用', isHidden,
          isHidden ? '加入轨道' : '收回', () => onToggleHidden(a.id), !isHidden));
      });

      return h('div', { className: 'sc-rail' + (open ? ' open' : '') },
        h('div', { className: 'sc-rail-tab', onClick: onToggle, title: open ? '收起' : '展开扩展列表' },
          h('span', { className: 'n' }, String(packs.length + imports.length + picked.length)),
          h('span', null, '扩展')),
        open ? h('div', { className: 'sc-rail-body' },
          h('div', { className: 'sc-rail-hd' },
            h('span', { className: 't' }, '扩展 / EXTENSIONS'),
            h('span', { className: 'x', onClick: onToggle, title: '收起来' }, '✕')),
          h('button', { className: 'sc-import', onClick: () => fileRef.current && fileRef.current.click() },
            '＋ 导入 zip'),
          h('input', {
            ref: fileRef, type: 'file', accept: '.zip', multiple: true,
            style: { display: 'none' },
            onChange: (e) => {
              const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, bytes: f.size }));
              if (files.length) onPick(files);
              e.target.value = '';
            },
          }),
          h('div', { className: 'sc-rail-list' }, rows.length ? rows : h('div', { className: 'sc-rail-tip' }, '还没有扩展')),
          h('div', { className: 'sc-toast' }, toast || ''),
          h('div', { className: 'sc-rail-tip' },
            '「加入轨道」只控制界面显示；真正装包要在仓库跑：',
            h('div', { style: { color: '#7fb6d9' } }, 'node tools/cli.mjs pack import <zip>')))
        : null);
    }

    /* ┢�┢� 模块页（占位�?┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function ModulePage(props) {
      const { adapter, onBack } = props;
      return h('div', { className: 'sc-module' },
        h('div', { className: 'sub' }, '小适配器 · 对应的模块'),
        h('h2', null, adapter.name),
        h('div', { className: 'sc-chips' },
          h('span', { className: 'sc-chip' }, `发布人 ${adapter.publisher}`),
          h('span', { className: 'sc-chip' }, `版本 v${adapter.version}`),
          h('span', { className: 'sc-chip' }, `协议 v${adapter.protocol}`),
          h('span', { className: 'sc-chip' }, adapter.enabled ? '已启用' : '未启用'),
          (adapter.trust || []).map((t) => h('span', { key: t, className: 'sc-chip' }, `信任 ${t}`))),
        h('div', { className: 'sc-box' },
          h('p', null, '这个模块的界面还没做。'),
          h('p', null, `它声明了入口 ${adapter.entry || '—'}；需要的能力：${(adapter.requires || []).join('、') || '无'}。`),
          h('p', null, '按四段刚性：契约写在这个小适配器里；它的模块本体只处理这个平台自己的规矩。'),
          h('button', { className: 'sc-backlink', onClick: onBack }, '← 返回')),
      );
    }

    /* ┢�┢� 兜底 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error) { console.error('[surfcore-ui] 渲染失败', error); }
      render() {
        if (!this.state.error) return this.props.children;
        const e = this.state.error;
        return h('div', { style: { padding: '24px 26px', color: '#fecaca', fontSize: 12, lineHeight: 1.8 } },
          h('div', { style: { fontSize: 13, letterSpacing: '.16em', color: '#fca5a5', marginBottom: 8 } }, 'SURFCORE UI 渲染失败'),
          h('pre', { style: { whiteSpace: 'pre-wrap', color: '#fda4af' } }, String(e && e.stack ? e.stack : e)),
          h('button', {
            style: { marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,.5)', background: 'transparent', color: '#fecaca', cursor: 'pointer' },
            onClick: () => this.setState({ error: null }),
          }, '重试'));
      }
    }

    /* ┢�┢� 面板 ┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢�┢� */
    function Panel() {
      /* 视图栈：kernel �?inside �?block �?kernel �?adapters �?module */
      const [view, setView] = useState('kernel');
      const [phase, setPhase] = useState(null);
      const [closing, setClosing] = useState(false);   // 关闭内核时的前倾动画
      const [railOpen, setRailOpen] = useState(false);
      const [picked, setPicked] = useState([]);
      const [toast, setToast] = useState('');
      const [hidden, setHidden] = useState(() => {
        try { return JSON.parse(localStorage.getItem('surfcore.hidden') || '[]'); } catch { return []; }
      });
      const [blockId, setBlockId] = useState(null);
      const [groupId, setGroupId] = useState(null);
      const [moduleId, setModuleId] = useState(null);
      const [now, setNow] = useState(() => new Date());
      const [tick, setTick] = useState(0);

      useEffect(() => {
        const t1 = setInterval(() => setNow(new Date()), 1000);
        const t2 = setInterval(() => setTick((n) => n + 1), 1000);
        return () => { clearInterval(t1); clearInterval(t2); };
      }, []);

      const block = useMemo(() => BLOCKS.find((b) => b.id === blockId) || null, [blockId]);
      const group = useMemo(() => GROUPS.find((g) => g.id === groupId) || null, [groupId]);
      const moduleAdapter = useMemo(() => ADAPTERS.find((a) => a.id === moduleId) || null, [moduleId]);
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      const back = () => {
        if (phase) return;
        if (closing) return;
        if (view === 'module') { setView('adapters'); return; }
        if (view === 'adapters') { setView('kernel'); return; }
        if (view === 'block') { setView(groupId ? 'group' : 'inside'); return; }
        if (view === 'group') { setView('inside'); return; }
        if (view === 'inside') {
          // 关闭内核：前倾回正 + 淡出，然后回到外层
          setClosing(true);
          setTimeout(() => { setView('kernel'); setClosing(false); }, 430);
        }
      };

      // 点内核：不再做"放大"转场，直接进内层；后仰/发光/投影升起由内层动画完成
      const goInside = () => {
        if (phase) return;
        setView('inside');
      };
      const goOutside = () => {
        if (phase) return;
        setPhase('out');
        setTimeout(() => { setView('adapters'); setPhase(null); }, 560);
      };
      const openBlock = (id) => { setBlockId(id); setView('block'); };
      const openGroup = (id) => {
        const g = GROUPS.find((x) => x.id === id);
        if (!g) return;
        if (g.blocks.length === 1) {
          setGroupId(null);
          setBlockId(g.blocks[0]);
          setView('block');
          return;
        }
        setGroupId(id);
        setView('group');
      };
      const openModule = (id) => { setModuleId(id); setView('module'); };

      const toggleHidden = (id) => {
        setHidden((prev) => {
          const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
          try { localStorage.setItem('surfcore.hidden', JSON.stringify(next)); } catch { /* 无痕模式 */ }
          return next;
        });
      };

      const copyImport = (name) => {
        const cmd = 'node tools/cli.mjs pack import imports/' + name;
        try {
          if (navigator && navigator.clipboard) navigator.clipboard.writeText(cmd);
        } catch { /* 剪贴板不可用就只显示 */ }
        setToast('已复制：' + cmd);
        setTimeout(() => setToast(''), 4000);
      };

      const visible = ADAPTERS.filter((a) => !hidden.includes(a.id));

      const crumb = view === 'kernel' || view === 'inside' ? 'KERNEL'
        : view === 'group' ? `KERNEL / ${group ? group.en : ''}`
          : view === 'block' ? `KERNEL / ${group ? group.en + ' / ' : ''}${block ? block.en : ''}`
            : view === 'adapters' ? 'ADAPTERS'
              : (moduleAdapter ? moduleAdapter.name.toUpperCase() : 'MODULE');

      return h(React.Fragment, null,
        h('style', null, CSS),
        h(Boundary, null, h('div', {
          className: 'sc-root',
          onContextMenu: (e) => {
            if (isEditableContextTarget(e.target)) return;
            e.preventDefault();
            back();
          },   /* 全局右键 = 返回；输入控件内保留原生菜单 */
        },
          h('div', { className: 'sc-bg', style: { '--bg': BG ? 'url(' + BG + ')' : 'none' } }),
          h(LightPaths),
          h('div', { className: 'sc-grid' }),
          h('div', { className: 'sc-scan' }),
          h('div', { className: 'sc-hud' },
            h('span', { className: 'sc-mark' }),
            h('span', { className: 'sc-title' }, 'SURFCORE'),
            h('span', { className: 'sc-badge' }, crumb),
            view !== 'kernel' ? h('button', { className: 'sc-crumb', onClick: back }, '← 返回') : null,
            h('span', { className: 'sc-spacer' }),
            h('span', { className: 'sc-clock' }, clock),
            h('span', { className: 'sc-badge', style: { color: '#67e8f9' } }, 'ONLINE'),
            h('span', { className: 'sc-build' }, BUILD)),

          h('div', { className: 'sc-stage' },
            view === 'kernel' ? h('div', { className: `sc-zoomwrap${phase ? ` ${phase}` : ''}` },
              h('div', { className: 'sc-kernel-in' },
                h(KernelOuter, { onInside: goInside, onOutside: goOutside, tick }))) : null,
            view === 'inside' ? h('div', { className: 'sc-tiltwrap' },
              h('div', { className: 'sc-tilt' + (closing ? ' out' : '') },
                h(KernelDeck, { onOpenGroup: openGroup }))) : null,
            view === 'group' && group ? h('div', { className: 'sc-enter', style: { position: 'absolute', inset: 0 } },
              h(GroupPage, { group, onOpen: openBlock, onBack: back })) : null,
            view === 'block' && block ? h('div', { className: 'sc-enter', style: { position: 'absolute', inset: 0 } },
              h(BlockPage, { block, onBack: back })) : null,
            view === 'adapters' ? h('div', { className: 'sc-enter', style: { position: 'absolute', inset: 0 } },
              h('div', { className: 'sc-adapters' },
                h(Rail, {
                  open: railOpen,
                  onToggle: () => setRailOpen((v) => !v),
                  packs: ADAPTERS,
                  imports: IMPORTS,
                  hidden,
                  onToggleHidden: toggleHidden,
                  picked,
                  onPick: (files) => { setPicked((prev) => [...prev, ...files]); setRailOpen(true); },
                  onCopy: copyImport,
                  toast,
                }),
                h('div', { style: { position: 'relative', flex: 1, minWidth: 0 } },
                  h(Galaxy, { adapters: visible, meta: ADAPTER_META, onOpen: openModule })))) : null,
            view === 'module' && moduleAdapter ? h(ModulePage, { adapter: moduleAdapter, onBack: back }) : null),

          h('div', { className: 'sc-flow' },
            h('span', { className: 'sc-pill' }, '四段刚性'),
            h('span', null, view === 'adapters'
              ? '星环 = 大适配器的接口位 · 每个点是一个小适配器 · 名字与版本读自它自己的 pack.json'
              : view === 'block'
                ? '这一页的数据来自能力清单与内核设置声明（构建时打进来）'
                : view === 'group'
                  ? '这一组只是区块入口；点进去才是该块的能力/设置'
                  : '中心 = 内核 · 外环 = 适配器星环 · 右键任何地方返回')),
        )),
      );
    }

    return {
      __pages: { MemoryPage, MemoryGuidePage, NarrativePane, VectorPane, VectorConfigTab, LocalModelsTab, ProviderModelsTab, MemorySettingsPanel, MemoryModeDialog, MemorySnapshotNote, MemRecordRow, LibraryPane, MemorySpacePane, MemorySpaceCanvas, MemSourceTag, VoiceControlPage, VoiceModelCard, VoiceProviderPanel, VoiceImportDialog, VoiceRelinkDialog, VoiceSynthDialog },
      __memoryApi: memApi,
      __memoryRequest: memRequest,
      __memoryHooks: { useMemoryLoad, useMemoryAction, useMemoryJob },
      __memorySpace: { project: memSpaceProject, layout: memSpaceLayout, color: memSpaceColor, limit: MEM_SPACE_LIMIT },
      __guards: { isEditableContextTarget },
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'surfcore', order: -10, label: 'SurfCore',
        }, Icon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'surfcore',
        }, Panel));
      },
    };
  },
});
