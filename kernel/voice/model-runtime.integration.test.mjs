/**
 * 模型验收链路：import zip → 删除源 zip → load → probe → unload
 * 跑法：node kernel/voice/model-runtime.integration.test.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVoiceModels } from './models.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-model-chain-'));
const src = path.join(dir, 'src');
const target = path.join(dir, 'installed');
const configFile = path.join(dir, 'models.json');
fs.mkdirSync(path.join(src, 'runtime'), { recursive: true });

const server = `const http=require('http');
const data=Buffer.alloc(1000);
const b=Buffer.alloc(44+data.length);
b.write('RIFF',0);b.writeUInt32LE(36+data.length,4);b.write('WAVE',8);
b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
b.writeUInt32LE(8000,24);b.writeUInt32LE(8000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);
b.write('data',36);b.writeUInt32LE(data.length,40);data.copy(b,44);
http.createServer((req,res)=>{let n=0;req.on('data',c=>n+=c.length);req.on('end',()=>{res.writeHead(200,{'content-type':'audio/wav'});res.end(b);});}).listen(18766,'127.0.0.1');`;
const entry = 'runtime/server.js';
fs.writeFileSync(path.join(src, entry), server);
const entrySha = crypto.createHash('sha256').update(server).digest('hex');
fs.writeFileSync(path.join(src, 'model.json'), JSON.stringify({
  kind: 'surfcore-voice-model', model: 'local-chain', version: '1.0.0',
  voice: { id: 'v1' },
  files: [{ path: entry, sha256: entrySha }],
  runtime: { kind: 'process', command: 'node', entry, args: [], endpoint: 'http://127.0.0.1:18766', transport: 'http' },
}));

const zip = path.join(dir, 'model.zip');
const tarBin = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
const tar = spawnSync(tarBin, ['-a', '-cf', zip, '-C', src, '.'], { stdio: 'ignore' });

try {
  console.log('## import zip + deleteSource');
  const models = createVoiceModels({ configFile, providersFile: path.join(dir, 'providers.json') });
  {
    ok(tar.status === 0 && fs.existsSync(zip), '测试 zip 生成');
    const r = await models.importModel({
      sourceDir: zip,
      targetDir: target,
      deleteSource: true,
      model: { id: 'local-chain', kind: 'local', voiceId: 'v1' },
    });
    ok(r.ok && r.sourceDeleted === true, 'import 成功且 sourceDeleted=true');
    ok(!fs.existsSync(zip), '源 zip 已删除');
  }

  console.log('\n## load → probe → unload');
  {
    const loaded = await models.load('local-chain');
    ok(loaded.ok && loaded.state === 'loaded', '内核自己拉起 runtime');
    const probe = await models.probe('local-chain', '你好');
    ok(probe.ok && probe.bytes?.length > 44, 'probe 拿到音频');
    const unloaded = await models.unload('local-chain');
    ok(unloaded.ok && unloaded.state === 'idle', '卸载 runtime');
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
