import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cleanDisplayName, hashPassword, MIN_PASSWORD, setupKeyMatches, verifyPassword } from '../server/lib.mjs';

test('password hash matches the Kindred scrypt string and checks in constant form', async () => {
  const stored = await hashPassword('correct horse');
  const parts = stored.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '16384');
  assert.equal(parts[2], '8');
  assert.equal(parts[3], '1');
  assert.equal(Buffer.from(parts[5], 'base64').length, 32);
  assert.equal(await verifyPassword('correct horse', stored), true);
  assert.equal(await verifyPassword('wrong horse', stored), false);
  assert.equal(await verifyPassword('correct horse', 'nope'), false);
  assert.equal(await verifyPassword('correct horse', 'scrypt$16384$8$1$$'), false);
  // NFKC: a composed character and its decomposed form are the same password.
  const composed = await hashPassword('\u00e9');
  assert.equal(await verifyPassword('e\u0301', composed), true);
  assert.equal(MIN_PASSWORD, 8);
});

test('setup key is optional and compared without leaking the length', () => {
  const previous = process.env.SETUP_KEY;
  try {
    delete process.env.SETUP_KEY;
    assert.equal(setupKeyMatches(''), true);
    assert.equal(setupKeyMatches('anything'), true);
    process.env.SETUP_KEY = 'gate-key';
    assert.equal(setupKeyMatches('gate-key'), true);
    assert.equal(setupKeyMatches('nope'), false);
    assert.equal(setupKeyMatches(''), false);
  } finally {
    if (previous == null) delete process.env.SETUP_KEY;
    else process.env.SETUP_KEY = previous;
  }
});

test('passwd keeps the display name and signs that account out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-users-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({
    users: { manaiakalani: { hash: 'old', name: 'Max', changed: 1 } },
  }));
  const child = spawn(process.execPath, ['server/users.mjs', 'passwd', 'manaiakalani'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { PATH: process.env.PATH, DATA_DIR: dir },
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.end('longer-shelf-password\n');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, err);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
  const user = saved.users.manaiakalani;
  assert.equal(user.name, 'Max');
  assert.match(user.hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(user.changed > 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('display names keep letters and reject an empty or symbolic name', () => {
  assert.equal(cleanDisplayName('  Anna  Stein '), 'Anna Stein');
  assert.equal(cleanDisplayName(''), '');
  assert.equal(cleanDisplayName('Max & Anna'), '');
  assert.equal(cleanDisplayName('x'.repeat(41)), '');
});
