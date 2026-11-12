/**
 * 白名单测试
 * 跑法：node runtime/allowlist.test.mjs
 */
import { createAllowlist } from './allowlist.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 默认 fail-closed');
{
  const l = createAllowlist();
  ok(!l.check({ channel: 'group:1' }).ok, '没配白名单：群一律不放行');
  ok(l.check({ channel: 'group:1' }).reason === 'empty-allowlist', '原因写明"名单是空的"');
  ok(l.check({ channel: 'terminal:main' }).ok === true, '不归它管的频道（终端）：交给那个渠道自己的策略');
  ok(l.check({ channel: 'terminal:main' }).reason === 'not-governed', '说明"不归我管"，不是放水');
}

console.log('\n## 名单匹配（两种写法都认）');
{
  const l = createAllowlist({ groups: ['123', 'group:456'], privates: ['789'] });
  ok(l.check({ channel: 'group:123' }).ok, '群 123：放行（纯数字写法）');
  ok(l.check({ channel: 'group:456' }).ok, '群 456：放行（带前缀写法）');
  ok(!l.check({ channel: 'group:999' }).ok, '群 999：拦');
  ok(l.check({ channel: 'private:789' }).ok, '私聊 789：放行');
  ok(!l.check({ channel: 'private:999' }).ok, '私聊 999：拦');
  ok(l.check({ channel: 'private:999' }).reason === 'not-listed', '原因写明"不在名单"');
}

console.log('\n## 主人永远放行');
{
  const l = createAllowlist({ groups: ['123'], ownerId: '10001' });
  ok(l.check({ channel: 'group:999', actor: '10001' }).reason === 'owner', '主人私聊/群：一律放行');
  ok(l.check({ channel: 'group:999', actor: '20002', isOwner: true }).ok, '事件里标了主人：也放行');
}

console.log('\n## allowAll 与诊断');
{
  const l = createAllowlist({ allowAll: true });
  ok(l.check({ channel: 'group:随便' }).ok, 'allowAll：全放行');
  ok(l.check({ channel: 'group:1' }).reason === 'allow-all', '原因写明 allow-all');
  const snap = createAllowlist({ groups: ['1'], privates: ['2'], ownerId: '9' }).snapshot();
  ok(snap.groups.join() === '1' && snap.privates.join() === '2' && snap.owner === '9', '快照可读（给设置页用）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
