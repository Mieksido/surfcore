import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../lib/paths.js', import.meta.url).href;

function probe(existing) {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'surfcore-private-')
  );
  try {
    const qq = path.join(tmp, 'qq');
    const dsh = path.join(tmp, 'dsh');

    fs.mkdirSync(path.join(qq, 'src'), { recursive: true });
    fs.writeFileSync(path.join(qq, 'config.json'), '{}');
    fs.writeFileSync(path.join(qq, 'src', 'bridge.js'), '');

    if (existing) {
      fs.mkdirSync(path.join(dsh, 'surfcore'), {
        recursive: true,
        mode: 0o755,
      });
    }

    const code = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import * as p from ${JSON.stringify(moduleUrl)};

      p.ensureDirs();

      for (const dir of [
        p.BACKUP_DIR,
        p.MEMORY_DIR,
        p.QQ_STATE_DIR,
        p.BILI_DIR,
      ]) {
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700, dir);
      }

      assert.equal(
        fs.statSync(p.STATE_DIR).mode & 0o777,
        ${existing ? '0o755' : '0o700'}
      );
    `;

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', code],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: path.join(tmp, 'home'),
          USERPROFILE: path.join(tmp, 'wrong-home'),
          DSH_HOME: dsh,
          SURFCORE_ROOT: qq,
        },
      }
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('新建的敏感目录权限为 700', {
  skip: process.platform === 'win32',
}, () => probe(false));

test('不擅自修改已有目录权限', {
  skip: process.platform === 'win32',
}, () => probe(true));
