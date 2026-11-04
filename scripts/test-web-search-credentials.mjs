// web_search 凭据/端点边界：DSH 0.2.x records、账号 token 只能发官方域名。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertAccountEndpoint, mapApiSearchResponse, readDshCredential, resolveSearchApiKey,
} from '../src/web-search.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-websearch-'));
const oldHome = process.env.DSH_HOME;
try {
  process.env.DSH_HOME = root;
  fs.writeFileSync(path.join(root, '.credentials.yaml'), [
    'version: 1',
    'refs:',
    '  LEGACY_KEY: legacy-token',
    'records:',
    '  DEEPSEEK_API_KEY:',
    '    kind: api-key',
    '    payload:',
    '      token: record-api-token',
    '  deepseek-account-platform/default:',
    '    kind: deepseek-account',
    '    payload:',
    '      token: account-token',
    '      issuer: https://api.deepseek.com',
  ].join('\n'));

  assert.equal(readDshCredential('LEGACY_KEY'), 'legacy-token');
  assert.equal(readDshCredential('DEEPSEEK_API_KEY'), 'record-api-token');
  assert.equal(readDshCredential('deepseek-account-platform/default'), 'account-token');
  assert.equal(readDshCredential('missing'), '');

  assert.deepEqual(
    resolveSearchApiKey({ apiKeyEnv: 'DEEPSEEK_API_KEY' }),
    { key: 'record-api-token', source: 'dsh-credentials' },
  );
  assert.deepEqual(
    resolveSearchApiKey({ apiKeyEnv: 'NO_SUCH_REF' }),
    { key: 'account-token', source: 'dsh-account-credential' },
  );
  assert.deepEqual(
    resolveSearchApiKey({ apiKey: 'literal-key', apiKeyEnv: 'DEEPSEEK_API_KEY' }),
    { key: 'literal-key', source: 'config' },
  );

  assert.doesNotThrow(() => assertAccountEndpoint('https://api.deepseek.com/v1/tools'));
  assert.throws(() => assertAccountEndpoint('https://evil.example/v1/tools'), /只能发往/);
  assert.throws(() => assertAccountEndpoint('http://api.deepseek.com/v1/tools'), /只能发往/);

  const mapped = mapApiSearchResponse({
    results: [
      { url: 'https://example.com/a#1', title: 'A', summary: 'S' },
      { url: 'https://example.com/a', title: 'dup' },
      { url: 'javascript:alert(1)', title: 'bad' },
      { url: 'https://example.com/b', title: 'B' },
    ],
  }, 2);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].url, 'https://example.com/a');
  assert.equal(mapped[0].snippet, 'S');

  const src = fs.readFileSync('src/web-search.js', 'utf8');
  assert.ok(src.includes("'x-dsh-auth-token'"), '账号 token 必须用 x-dsh-auth-token');
  assert.ok(src.includes("DEFAULT_ACCOUNT_CREDENTIAL") && src.includes("payload?.token"), '必须认 records.payload.token');
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = oldHome;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ web_search 凭据/端点边界测试通过');
