// 表情包体系自检：
// 1) sticker-lib 纯函数（合并/查找/格式化/笔记/使用统计）
// 2) 配置项与 MCP 工具描述存在性
// 3) 可选 live 模式：QQ_BRIDGE_TEST_LIVE=1 时调用 SnowLuma 拉取收藏表情并验证 safeFetchBuffer 可抓图
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeStickerEntry,
  mergeStickerLibrary,
  findSticker,
  formatStickerList,
  buildStickerContext,
  buildStickerStrategyHint,
  applyStickerNote,
  markStickerUsed
} from '../src/sticker-lib.js';
import { ensureStickerIndex } from '../src/sticker-semantics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.error(`  ❌ ${name}`); }
}

console.log('## sticker-lib 纯函数');
{
  const raw = normalizeStickerEntry({ emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'abc', desc: '笑死', localNote: '嘲讽', tags: ['怼人'] });
  ok(raw && raw.id === 'a' && raw.desc === '笑死' && raw.localNote === '嘲讽', 'normalizeStickerEntry 基本字段');
  ok(normalizeStickerEntry({}) === null, '空记录返回 null');
  const meta = normalizeStickerEntry({
    emoji_id: 'b', no: 7, emotion: '委屈', emotionAlt: ['馋饿', '委屈'], content: '抱着碗委屈巴巴',
    keywords: ['要饭', '饿了']
  });
  ok(meta.no === 7, 'normalizeStickerEntry 保留编号');
  ok(meta.emotion === 'wronged', '中文情绪标签归一成 key');
  ok(meta.emotionAlt.length === 1 && meta.emotionAlt[0] === 'hungry', '副情绪归一且不等于主情绪（「委屈」被去掉）');
  ok(meta.content === '抱着碗委屈巴巴' && meta.keywords.includes('要饭'), '内容/关键词保留');
  ok(normalizeStickerEntry({ emoji_id: 'c', emotion: '不存在的情绪' }).emotion === '', '非法情绪被丢弃（留给自动标注兜底）');
}

{
  const base = mergeStickerLibrary([], [
    { emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'ABC', desc: '笑死' },
    { emoji_id: 'b', resId: 'b', url: 'https://x/b', md5: 'DEF', desc: '' }
  ]);
  ok(base.length === 2, 'merge 新增两条');
  const merged = mergeStickerLibrary(base, [
    { emoji_id: 'a', resId: 'a', url: 'https://x/a2', md5: 'ABC', desc: '笑哭' }
  ]);
  ok(merged.length === 1, 'merge 会移除 QQ 端已删除的表情');
  ok(merged[0].id === 'a' && merged[0].url === 'https://x/a2' && merged[0].desc === '笑哭', 'merge 更新 QQ 字段');
}

{
  const list = mergeStickerLibrary([], [
    { emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'ABC', desc: '笑死' },
    { emoji_id: 'b', resId: 'b', url: 'https://x/b', md5: 'DEF', desc: '生气' }
  ]);
  ok(findSticker(list, 'a')?.id === 'a', '按 emoji_id 查找');
  ok(findSticker(list, 'abc')?.id === 'a', '按 md5 大小写不敏感查找');
  ok(findSticker(list, 'https://x/b')?.id === 'b', '按 URL 查找');
  ok(findSticker(list, '不存在') === null, '找不到返回 null');
}

{
  // 编号引用：发图时最省事的写法，findSticker 必须能解析（#02 / 2 / 2号）
  const { entries } = ensureStickerIndex(mergeStickerLibrary([], [
    { emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'ABC', desc: '笑死', createdAt: '2026-01-01T00:00:00Z' },
    { emoji_id: 'b', resId: 'b', url: 'https://x/b', md5: 'DEF', desc: '生气', createdAt: '2026-01-02T00:00:00Z' }
  ]));
  ok(findSticker(entries, '#02')?.id === 'b', '按编号 #02 查找');
  ok(findSticker(entries, '2')?.id === 'b', '按编号 2 查找');
  ok(findSticker(entries, '2号')?.id === 'b', '按编号 2号 查找');
  ok(findSticker(entries, '#01')?.id === 'a', '按编号 #01 查找');
}

{
  const list = [
    normalizeStickerEntry({ emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'ABC', desc: '笑死' }),
    normalizeStickerEntry({ emoji_id: 'b', resId: 'b', url: 'https://x/b', md5: 'DEF', desc: '生气' }),
    normalizeStickerEntry({ emoji_id: 'c', resId: 'c', url: 'https://x/c', md5: 'GHI', desc: '', localNote: '无语' })
  ];
  const all = formatStickerList(list, '', 10);
  ok(all.total === 3 && all.stickers.length === 3, 'formatStickerList 总数');
  const q = formatStickerList(list, '生气', 10);
  ok(q.matched === 1 && q.stickers[0].id === 'b', 'formatStickerList 按备注搜索');
  const q2 = formatStickerList(list, '无语', 10);
  ok(q2.matched === 1 && q2.stickers[0].id === 'c', 'formatStickerList 按本地笔记搜索');
  const ctx = buildStickerContext(list, 8);
  ok(ctx.includes('笑死') && ctx.includes('生气'), 'buildStickerContext 包含备注');
  ok(buildStickerStrategyHint().includes('qq_send_sticker'), '策略提示包含发送工具');

  // 编号 + 情绪 + 内容都要出现在注入块里（模型靠这三样挑图）
  const numbered = ensureStickerIndex(list).entries;
  const ctx2 = buildStickerContext(numbered, 8);
  ok(/#0\d/.test(ctx2), '注入块带编号');
  ok(ctx2.includes('搞笑') || ctx2.includes('生气'), '注入块带情绪标签');
  ok(ctx2.includes('qq_send_sticker'), '注入块说明按编号发送');
  const item = formatStickerList(numbered, '', 10).stickers[0];
  ok(item.no >= 1 && item.ref.startsWith('#') && item.emotionLabel, 'formatStickerList 返回编号/情绪');
  const byEmotion = formatStickerList(numbered, '生气', 10);
  ok(byEmotion.matched === 1 && byEmotion.stickers[0].emotionLabel === '生气', '可按情绪搜索');
}

{
  const list = mergeStickerLibrary([], [
    { emoji_id: 'a', resId: 'a', url: 'https://x/a', md5: 'ABC', desc: '笑死' }
  ]);
  const noted = applyStickerNote(list, 'a', { note: '嘲讽用', tags: ['怼人'], usage: '别人犯蠢时' });
  ok(noted.entry.localNote === '嘲讽用' && noted.entry.tags.includes('怼人'), 'applyStickerNote 写入本地认知');
  const semantic = applyStickerNote(noted.entries, 'a', { emotion: '嘲讽', content: '半眯眼说杂鱼', keywords: ['杂鱼', '就这'] });
  ok(semantic.entry.emotion === 'tease' && semantic.entry.content === '半眯眼说杂鱼', 'applyStickerNote 写入情绪/内容');
  ok(semantic.entry.keywords.includes('就这'), 'applyStickerNote 写入关键词');
  const badEmotion = applyStickerNote(semantic.entries, 'a', { emotion: '乱写的' });
  ok(badEmotion.entry.emotion === 'tease', '非法情绪不覆盖原值');
  const used = markStickerUsed(noted.entries, 'a', '接梗');
  ok(used.entry.useCount === 1 && used.entry.lastContext === '接梗', 'markStickerUsed 记录使用');
}

console.log('## 配置文件');
{
  // Offline contract tests use the shipped, credential-free configuration.
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  const tools = cfg.socialV2?.tools ?? {};
  ok(tools.listStickers === true, 'config listStickers=true');
  ok(tools.getStickerImage === true, 'config getStickerImage=true');
  ok(tools.sendSticker === true, 'config sendSticker=true');
  ok(tools.stickerNote === true, 'config stickerNote=true');
  // 示例配置必须保持「默认禁用」；真实 config.json 允许管理员显式打开。
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  ok(example.socialV2?.tools?.setStickerRemark === false, '示例配置 setStickerRemark=false（默认禁用）');
  ok(typeof tools.setStickerRemark === 'boolean', 'config setStickerRemark 是布尔开关');
  ok(cfg.socialV2?.sticker?.enabled === true, 'config sticker.enabled=true');
  ok(!('sendCaptionMaxChars' in (cfg.socialV2?.sticker ?? {})), 'config sticker 不再包含 sendCaptionMaxChars');
}

console.log('## 表情单气泡约束');
{
  const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp-snowluma-safe.js'), 'utf8');
  const sendStickerBlock = mcp.slice(mcp.indexOf("'qq_send_sticker'"), mcp.indexOf("'qq_sticker_note'"));
  ok(!sendStickerBlock.includes('message: z.string()'), 'qq_send_sticker MCP 不再接受 message 参数');
  ok(sendStickerBlock.includes('不能在同一气泡里附带文字'), 'qq_send_sticker 描述强调单气泡');
  const hint = buildStickerStrategyHint();
  ok(hint.includes('不能在同一气泡里附带文字'), '策略提示禁止同气泡混文字');
  ok(!hint.includes('先发一句话再发一张'), '策略提示不再引导“先发一句话再发一张”');
}

console.log('## MCP 工具描述存在性');
{
  const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp-snowluma-safe.js'), 'utf8');
  for (const name of ['qq_list_stickers', 'qq_get_sticker_image', 'qq_send_sticker', 'qq_sticker_note', 'qq_set_sticker_remark', 'qq_collect_sticker']) {
    ok(mcp.includes(`'${name}'`) || mcp.includes(`"${name}"`), `MCP 工具 ${name} 已注册`);
  }
  const collectTool = mcp.slice(mcp.indexOf("'qq_collect_sticker'"), mcp.indexOf("'qq_collect_sticker'") + 2000);
  ok(collectTool.includes('emotion: z.enum(EMOTION_LABELS)'), '收藏工具带情绪分类参数');
  ok(collectTool.includes('content: z.string()'), '收藏工具带内容描述参数');
}

console.log('## bridge 路由/函数存在性');
{
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
  for (const s of ['/api/socialV2/sticker-list', '/api/socialV2/sticker-image', '/api/socialV2/sticker-note', '/api/socialV2/send-sticker', '/api/socialV2/sticker-remark', '/api/stickers', 'syncStickerLibrary', 'sendStickerV2']) {
    ok(bridge.includes(s), `bridge 包含 ${s}`);
  }
  // 编号/情绪/内容 + 唤醒时匹配的接线：只做静态断言，避免删掉某一段还自认为有功能
  for (const s of ['ensureStickerIndex(stickerEntries)', 'stickerMatchLine', 'rankStickers(stickerEntries', 'buildStickerMatchHint']) {
    ok(bridge.includes(s), `bridge 接线 ${s}`);
  }
  ok(bridge.includes('emotion: body.emotion') && bridge.includes('content: body.content'), '收藏通道接收 emotion/content');
  // 2026-10-24 实测：消息在 qq_wait_for_messages 期间到达时不会重建唤醒提示，
  // 所以 wait / unread 的返回也必须带同一份推荐，否则「表情匹配」只在一半路径上存在。
  ok(bridge.includes('function stickerMatchFor'), 'bridge 有统一的 stickerMatchFor');
  ok(/const stickerMatch = newMessages\.length \? stickerMatchFor\(newMessages\) : null/.test(bridge), 'wait 返回带 stickerMatch');
  ok(/const stickerMatch = stickerMatchFor\(messages\);/.test(bridge), 'unread 返回带 stickerMatch');
  ok(bridge.includes('...(stickerMatch ? { stickerMatch } : {})'), 'wait/unread 响应序列化 stickerMatch');
  const hint = buildStickerStrategyHint();
  ok(hint.includes('stickerMatch'), '策略提示告知 wait/unread 也会带推荐');
}

if (process.env.QQ_BRIDGE_TEST_LIVE === '1') {
  console.log('## live：SnowLuma 收藏表情链路');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    const base = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const headers = { 'content-type': 'application/json', ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {}) };
    const res = await fetch(`${base}/fetch_custom_face_detail`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ count: 5 }),
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json();
    ok(res.ok && body.status === 'ok' && body.retcode === 0, 'fetch_custom_face_detail 调用成功');
    const items = Array.isArray(body.data) ? body.data : [];
    ok(items.length > 0, `返回 ${items.length} 个收藏表情`);
    if (items.length > 0) {
      const { safeFetchBuffer } = await import('../src/safe-fetch.js');
      try {
        const img = await safeFetchBuffer(items[0].url, 4 * 1024 * 1024);
        ok(img.buffer.length > 0, `可抓取表情图片字节（${img.buffer.length} bytes）`);
      } catch (e) {
        ok(false, `safeFetchBuffer 抓取表情失败: ${e.message}`);
      }
    }
  } catch (e) {
    ok(false, `live 链路异常: ${e.message}`);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
