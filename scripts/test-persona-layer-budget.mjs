// 人格分层独立预算 / 身份去重 / 提示词风格可配置 —— 回归测试
// 背景：视频评论区反馈「分层不生效、只注入核心、撑爆注入上限」（2026-11-04）
import assert from 'node:assert/strict';
import { composePersonaLayers, PERSONA_LAYER_DEFAULT_CAPS } from '../src/persona-layers.js';

const pad = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);

// 1) 分层独立预算：核心写满，语气/场景/日常仍能注入
{
  const r = composePersonaLayers({
    core: '你是测试角色；你的主人是测试主人。' + pad('核心设定。', 4000),
    identity: '你是测试角色；你的主人是测试主人。',
    tone: pad('语气层。', 2000),
    scene: pad('场景层。', 1500),
    daily: pad('日常层。', 1000),
    maxChars: 6000,
    layerMaxChars: PERSONA_LAYER_DEFAULT_CAPS,
    sceneId: 'qq-group',
  });
  assert.equal(r.budgetMode, 'layers', '应走分层预算模式');
  assert.ok(r.layers.core > 0, '核心应有内容');
  assert.ok(r.layers.core <= 6000, '核心不应超过 maxChars');
  assert.ok(r.layers.tone > 0, '语气层应被注入（旧逻辑会被核心挤掉）');
  assert.ok(r.layers.scene > 0, '场景层应被注入');
  assert.ok(r.layers.daily > 0, '日常层应被注入');
  assert.ok(r.layers.tone <= PERSONA_LAYER_DEFAULT_CAPS.tone + 20, '语气层应受独立上限约束');
  assert.ok(r.text.includes('【人格语气】') && r.text.includes('【人格日常】'), '应带层标题');
  assert.ok(!r.text.includes('【身份底座】'), '核心已含“你的主人是”时，身份底座应去重');
}

// 2) 某一层设为 0 = 关闭该层
{
  const r = composePersonaLayers({
    core: '核心', tone: '语气', scene: '场景', daily: '日常',
    maxChars: 6000, layerMaxChars: { ...PERSONA_LAYER_DEFAULT_CAPS, tone: 0 },
  });
  assert.ok(!r.text.includes('【人格语气】'), 'tone=0 时不应注入语气层');
  assert.ok(r.text.includes('【人格日常】'), '其他层不受影响');
}

// 3) 不传 layerMaxChars：保持旧的总预算行为（向后兼容）
{
  const r = composePersonaLayers({ core: pad('a', 6000), tone: pad('b', 3000), maxChars: 6000 });
  assert.equal(r.budgetMode, 'total', '未传分层预算时走旧逻辑');
  assert.equal(r.truncated, true, '总预算不够时应标记截断');
}

// 4) 核心超过 maxChars：分层模式下仍受核心上限约束并标记截断
{
  const r = composePersonaLayers({
    core: pad('c', 7000), tone: '语气',
    maxChars: 6000, layerMaxChars: {},
  });
  assert.ok(r.layers.core <= 6000, '核心应被截断到 maxChars');
  assert.equal(r.truncated, true, '截断应被标记');
  assert.ok(r.layers.tone > 0, '语气层依然有独立预算');
}

// 5) 核心没有身份描述时，身份底座正常注入
{
  const r = composePersonaLayers({
    core: '只是一个角色卡', identity: '你是测试角色；你的主人是测试主人。',
    maxChars: 6000, layerMaxChars: {},
  });
  assert.ok(r.text.includes('【身份底座】'), '核心没写身份时应注入身份底座');
}

console.log('✅ 人格分层预算 / 身份去重 / 兼容性 全部通过');
