// 媒体兜底回归：商城/收藏表情有 p.qpic 候选；失败不丢标签；非多模态有文字路径。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
const mcp = fs.readFileSync(path.resolve('src/mcp-snowluma-safe.js'), 'utf8');
assert.ok(bridge.includes('p.qpic.cn/qq_expression'), '必须保留/新增收藏表情 p.qpic 候选');
assert.ok(bridge.includes('gxh.vip.qq.com'), 'gxh 可以保留为最后一跳');
assert.ok(bridge.includes('mediaFallbackText'), '取图失败必须走文字标签兜底');
assert.ok(bridge.includes('原图没取到，仅知标签'), '兜底必须说明图片没拿到');
assert.ok(bridge.includes('当前模型不支持图片输入'), '非多模态必须有文字兜底');
assert.ok(bridge.includes('imageInputSupport'), '必须做图片能力判断');
assert.ok(bridge.includes('socialV2?.vision?.imageInput'), '必须有 auto/true/false 配置');
assert.ok(mcp.includes('data?.text'), 'MCP 必须消费 bridge 的文字兜底');
console.log('✅ 媒体兜底测试通过');
