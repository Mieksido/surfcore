import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const moduleUrl = pathToFileURL(
  fileURLToPath(new URL('../lib/paths.js', import.meta.url))
).href;

function probe(dshOverride) {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'surfcore-posix-')
  );
  const home = path.join(temp, 'home');
  const dsh = path.join(temp, 'dsh');

  try {
    const source = `
      import * as p from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify({
        home: p.HOME,
        dsh: p.DSH_HOME,
        state: p.STATE_DIR,
        maskedHome: p.maskPath(p.HOME + '/sample'),
        maskedDsh: p.maskPath(p.DSH_HOME + '/memory')
      }));
    `;

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: path.join(temp, 'fake-windows-home'),
          DSH_HOME: dshOverride ? dsh : '',
          DSH_NODE: '',
        },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    return { home, dsh, data: JSON.parse(result.stdout.trim()) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('POSIX 使用 HOME 而非 USERPROFILE', {
  skip: process.platform === 'win32',
}, () => {
  const { home, data } = probe(true);
  assert.equal(data.home, home);
  assert.equal(data.maskedHome, '$HOME/sample');
});

test('DSH_HOME 显式覆盖生效', {
  skip: process.platform === 'win32',
}, () => {
  const { dsh, data } = probe(true);
  assert.equal(data.dsh, dsh);
  assert.equal(data.state, path.join(dsh, 'surfcore'));
  assert.equal(data.maskedDsh, '$DSH_HOME/memory');
});

test('未配置 DSH_HOME 时使用 HOME/.dsh', {
  skip: process.platform === 'win32',
}, () => {
  const { home, data } = probe(false);
  assert.equal(data.dsh, path.join(home, '.dsh'));
});
