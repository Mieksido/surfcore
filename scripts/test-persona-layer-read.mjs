// 人格层读取回归：tone 必须读 persona.tone.md，不能回落到核心。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-persona-layer-'));
const dshHome = path.join(root, 'dsh');
const charDir = path.join(dshHome, 'surfcore', 'characters', 'char-test');
fs.mkdirSync(charDir, { recursive: true });
fs.writeFileSync(path.join(charDir, 'character.json'), JSON.stringify({ version: 1, id: 'char-test', name: '测试' }));
fs.writeFileSync(path.join(charDir, 'persona.md'), 'CORE_MARK\n');
fs.writeFileSync(path.join(charDir, 'persona.tone.md'), 'TONE_MARK\n');
fs.writeFileSync(path.join(charDir, 'persona.daily.md'), 'DAILY_MARK\n');
fs.mkdirSync(path.join(charDir, 'persona.scenes'), { recursive: true });
fs.writeFileSync(path.join(charDir, 'persona.scenes', 'qq-group.md'), 'SCENE_MARK\n');
fs.writeFileSync(path.join(dshHome, 'surfcore', 'characters', 'current.json'), JSON.stringify({
  version: 1, id: 'char-test', name: '测试', epoch: 1, switchedAt: new Date().toISOString(),
}));
process.env.DSH_HOME = dshHome;

try {
  const mod = await import('../src/character-persona.js');
  assert.equal(mod.readPersonaLayerText('core'), 'CORE_MARK\n');
  assert.equal(mod.readPersonaLayerText('tone'), 'TONE_MARK\n', 'tone 必须读 persona.tone.md');
  fs.rmSync(path.join(charDir, 'persona.tone.md'));
  assert.equal(mod.readPersonaLayerText('tone'), '', '没有 tone 文件时不能回退 core，否则 full 模式会重复核心');
  assert.equal(mod.readPersonaLayerText('daily'), 'DAILY_MARK\n');
  assert.equal(mod.readPersonaLayerText('scene', 'qq-group'), 'SCENE_MARK\n');
  assert.equal(mod.readPersonaLayerText('unknown'), 'CORE_MARK\n', '未知层才允许回落核心');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ 人格层读取测试通过');
