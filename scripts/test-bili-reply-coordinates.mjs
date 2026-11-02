// B站收件箱坐标：@ 一级评论要补 root=source；回复楼层不要拿 target 当 parent。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replyCoordinates, resolveLatestReply } from '../plugins/surfcore/tools/lib/msgfeed.mjs';

const cases = [
  {
    name: '@ 一条一级评论',
    input: { root: 0, sourceId: 1001, targetId: 0 },
    want: { root: '1001', parent: '1001' },
  },
  {
    name: '在线程里 @',
    input: { root: 500, sourceId: 1001, targetId: 0 },
    want: { root: '500', parent: '1001' },
  },
  {
    name: '回复线程里的评论',
    input: { root: 500, sourceId: 1001, targetId: 500 },
    want: { root: '500', parent: '1001' },
  },
  {
    name: '回复别人的一级评论（root 缺失，用 target 补）',
    input: { root: 0, sourceId: 1001, targetId: 500 },
    want: { root: '500', parent: '1001' },
  },
];
for (const item of cases) {
  assert.deepEqual(replyCoordinates(item.input), {
    root: item.want.root,
    parent: item.want.parent,
    sourceId: String(item.input.sourceId),
    targetId: String(item.input.targetId),
  }, item.name);
}

// resolveLatestReply：按来消息那条的 rpid 找，而不是拿它的 parent 去比。
{
  const originalFetch = globalThis.fetch;
  const replies = [
    { rpid: 1001, mid: 7, parent: 500, content: { message: '正确的这条' }, ctime: 10 },
    { rpid: 1002, mid: 7, parent: 700, content: { message: '同一个人另一条' }, ctime: 20 },
  ];
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = String(url);
    return { json: async () => ({ code: 0, data: { replies } }) };
  };
  try {
    const hit = await resolveLatestReply({ business: 1, oid: 42, root: 500, mid: '7', rpid: '1001', headers: {} });
    assert.equal(hit.rpid, '1001');
    assert.equal(hit.text, '正确的这条');
    assert.equal(hit.exact, true);
    assert.match(requested, /root=500/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 回归接线：@ 的 digest 也要打坐标；msgfeed 保留 source/target。
const digest = fs.readFileSync('plugins/surfcore/tools/commands/comment-digest.mjs', 'utf8');
const feed = fs.readFileSync('plugins/surfcore/tools/lib/msgfeed.mjs', 'utf8');
assert.match(digest, /else if \(x\.root \|\| x\.parent\).*坐标/s, '@ 消息没有坐标行');
assert.match(feed, /targetId: coords\.targetId/, 'msgfeed 没保留 target_id');
assert.match(feed, /String\(r\.rpid\) === wanted/, 'resolveLatestReply 仍拿 parent 比');
console.log('✅ B站回复坐标测试通过');
