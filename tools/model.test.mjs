/**
 * 模型选择测试（不联网：只验证"选哪个"和"如实说明"）
 * 跑法：node app/model.test.mjs
 */
import { pickModel } from './model.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 没配地址：离线桩');
{
  const p = pickModel({});
  ok(p.kind === 'stub', '用桩');
  ok(typeof p.model.complete === 'function', '桩也实现同一个端口（complete）');
  ok(p.info.includes('离线桩'), '**明说自己是桩**（不假装是真模型）');
}

console.log('\n## 配齐才连真模型');
{
  const p = pickModel({ SURFCORE_MODEL_ENDPOINT: 'http://127.0.0.1:9', SURFCORE_MODEL: 'x' });
  ok(p.kind === 'http', '两项都给了：连真模型');
  ok(p.info.includes('x') && p.info.includes('http://127.0.0.1:9'), '说明里写清模型与地址');

  ok(pickModel({ SURFCORE_MODEL: 'x' }).kind === 'stub', '只给模型名：仍是桩（缺地址）');
  ok(pickModel({ SURFCORE_MODEL_ENDPOINT: 'http://x' }).kind === 'stub', '只给地址：仍是桩（缺模型名）');
}

console.log('\n## 密钥不出现在说明里');
{
  const p = pickModel({ SURFCORE_MODEL_ENDPOINT: 'http://x', SURFCORE_MODEL: 'm', SURFCORE_MODEL_KEY: 'sk-secret-123' });
  ok(!p.info.includes('sk-secret'), '说明文本不含密钥');
  ok(!JSON.stringify(Object.keys(p)).includes('sk-'), '字段名也不泄漏');
}

console.log('\n## 空白值当作没配');
{
  ok(pickModel({ SURFCORE_MODEL_ENDPOINT: '   ', SURFCORE_MODEL: '  ' }).kind === 'stub', '全是空格：按没配处理');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
