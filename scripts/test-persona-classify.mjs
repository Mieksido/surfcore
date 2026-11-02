// 人格卡智能拆分：只返回草稿；模型不可用/JSON 坏必须结构化失败。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPersonaClassifier } from '../plugins/surfcore/lib/persona-classify.js';

const off = createPersonaClassifier({ ctx: { get: () => null } });
assert.equal(off.available(), false);
await assert.rejects(() => off.classify('一张人格卡'), (error) => {
  assert.equal(error.code, 'PERSONA_CLASSIFY_UNAVAILABLE');
  return true;
});

const parsed = off.parse('```json\n{"core":"核心","tone":"语气","daily":"日常","scenes":{"qq-group":"群"}}\n```');
assert.equal(parsed.core, '核心');
assert.equal(parsed.tone, '语气');
assert.equal(parsed.scenes['qq-group'], '群');
assert.equal(parsed.scenes.pet, '');
assert.throws(() => off.parse('没有 JSON'), /JSON/);

// 第一次模型输出不是 JSON 时，必须自动重试一次，并成功解析。
let calls = 0;
const retryClassifier = createPersonaClassifier({
  ctx: {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) };
      if (name === 'llm') return {
        stream() {
          calls += 1;
          const text = calls === 1
            ? '好的，我来帮你拆分这张人格卡。'
            : '{"core":"核心2","tone":"语气2","daily":"日常2","scenes":{"qq-group":"群2"}}';
          return (async function* () {
            yield { type: 'text-delta', text };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        },
      };
      return null;
    },
  },
});
const retried = await retryClassifier.classify('一张人格卡');
assert.equal(calls, 2, '第一次不是 JSON 必须重试一次');
assert.equal(retried.core, '核心2');
assert.equal(retried.tone, '语气2');

const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
const index = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
assert.ok(index.includes('withDailyIdentity') && index.includes('drafts.daily = withDailyIdentity'), '拆分/日常保存必须把身份写进日常');
const classifyAt = index.indexOf('async function handlePersonaClassify');
const classifySection = classifyAt >= 0 ? index.slice(classifyAt, classifyAt + 1800) : '';
assert.ok(!classifySection.includes("if (layer === 'daily')"), '拆分函数不能再引用保存函数里的 layer');
assert.ok(index.includes('PERSONA_CLASSIFY_INTERNAL'), '内部错误必须单独给 code');
assert.ok(index.includes('不是人格卡内容问题'), '内部错误不能甩锅给人格卡内容');
assert.ok(client.includes('Object.values(draft.scenes') && client.includes('先写一点人格内容'), '拆分应发送完整草稿并校验空输入');
assert.ok(client.includes('保存时自动写入'), '角色页必须说明日常自动写身份');
assert.ok(index.includes('/persona/classify'), '插件必须提供拆分接口');
assert.ok(client.includes('智能拆分当前人格'), '角色页必须提供智能拆分按钮');
assert.ok(client.includes('写法：'), '角色页必须给用户写法提示');
assert.ok(client.includes('不保证隐私完全隔离'), '场景说明必须带跨平台隐私警告');
assert.ok(client.includes('人格语气'), '角色页必须有语气编辑页');
console.log('✅ 人格卡智能拆分通过');
