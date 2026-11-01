// Real DSH plugin fixture: load only inside an isolated disposable test profile.
import yaml from 'js-yaml';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
export const inject = ['tools', 'agents', 'agentPresets'];
export function apply(ctx) {
  const resultFile = process.env.SURFCORE_GUARD_RESULT;
  assert.ok(resultFile, 'SURFCORE_GUARD_RESULT must name a disposable result file');
  const suffix = randomUUID();
  console.log('ACCEPTANCE plugin activated');
  setTimeout(async () => {
    const counts={hidden:0,denied:0,allowed:0}; let pre=0;
    try {
      for (const [name,key] of [['dev_acceptance_005','hidden'],['acceptance_005_untrusted','denied'],['mcp__web-search-safe__acceptance_005','allowed']]) {
        ctx.tools.register({name,description:'Side-effect-free acceptance counter',parameters:{type:'object',properties:{}},output:{schema:{type:'integer'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:()=>++counts[key]});
      }
      // dev_acceptance_005 is deliberately unknown to the static deny list;
      // use an existing restricted name with an inert fixture only if absent.
      assert.equal(ctx.tools.get('bash'),undefined,'fixture must never replace a real tool');
      ctx.tools.register({name:'bash',description:'INERT counter; no shell',parameters:{type:'object',properties:{}},output:{schema:{type:'integer'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:()=>++counts.hidden});
      ctx.on('tools/pre-execute',async(exec,next)=>{pre++;return next();});
      const document=await ctx.agentPresets.readDocument('qq-chat-v2');
      const plugins=yaml.load(document.content);
      await ctx.agentPresets.register({id:`qq-chat-v2-acceptance-${suffix}`,plugins});
      const preset=await ctx.agentPresets.resolve(`qq-chat-v2-acceptance-${suffix}`); assert.equal(preset.broken,undefined);
      const qq=await ctx.agents.create({sessionId:`acceptance-qq-${suffix}`,setup:async ac=>{await ctx.agentPresets.mount(ac,`qq-chat-v2-acceptance-${suffix}`);}});
      const normal=await ctx.agents.create({sessionId:`acceptance-normal-${suffix}`});
      // handles expose agent; fail visibly if this installed version differs.
      const q=qq.agent, n=normal.agent; assert.ok(q&&n);
      const names=a=>ctx.tools.schemas(a).map(t=>t.name);
      assert.ok(!names(q).includes('bash')); assert.ok(names(n).includes('bash'));
      assert.ok(names(q).includes('acceptance_005_untrusted'));
      console.log('PASS scope and schema: QQ bash hidden; normal bash visible');
      assert.equal(ctx.tools.get('pwsh'),undefined);
      ctx.tools.register({name:'pwsh',description:'INERT late counter',parameters:{type:'object',properties:{}},output:{schema:{type:'integer'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:()=>++counts.hidden});
      assert.ok(!names(q).includes('pwsh'));assert.ok(names(n).includes('pwsh'));
      console.log('PASS late registered dangerous global hidden only for QQ');
      const run=(agent,name)=>ctx.tools.execute({agent,name,arguments:{},callId:crypto.randomUUID(),signal:new AbortController().signal});
      for(const name of ['bash','acceptance_005_untrusted','dev_acceptance_005']) {
        const result=await run(q,name); assert.equal(result.isError,true); assert.match(result.error.message,/QQ.*白名单/);
      }
      assert.deepEqual(counts,{hidden:0,denied:0,allowed:0}); assert.equal(pre,3);
      console.log('PASS real pre-execute + Guard: three denied calls; body counters all zero');
      assert.equal((await run(q,'mcp__web-search-safe__acceptance_005')).isError,false); assert.equal(counts.allowed,1);
      console.log('PASS harmless allowed fixture executes once');
      assert.equal((await run(n,'bash')).isError,false);assert.equal((await run(n,'acceptance_005_untrusted')).isError,false);
      assert.deepEqual(counts,{hidden:1,denied:1,allowed:1});assert.equal(pre,6);
      console.log('PASS normal Agent unaffected; counters='+JSON.stringify(counts)+' pre='+pre);
      fs.writeFileSync(resultFile,JSON.stringify({ok:true,counts,pre,checks:6}));
    } catch(e) { console.error('ACCEPTANCE FAIL',e.stack);fs.writeFileSync(resultFile,JSON.stringify({ok:false,error:e.message})); }
  }, 3000);
}
