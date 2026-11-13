import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'app', 'dist-server');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function start(extra = {}) {
  if (!existsSync(path.join(web, 'index.html'))) throw new Error('Build the app first: npm run build --prefix app');
  const dir = await mkdtemp(path.join(tmpdir(), 'filament-shelf-'));
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH || '',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dir,
      WEB_DIR: web,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'none',
      PUBLIC_ORIGIN: '',
      SETUP_KEY: extra.SETUP_KEY || '',
      SESSION_DAYS: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 8000;
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(log || 'server exited');
    try {
      const r = await fetch(base + '/healthz');
      if (r.ok) { up = true; break; }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 40));
  }
  if (!up) { child.kill('SIGKILL'); throw new Error('server did not start\n' + log); }
  return {
    base,
    log: () => log,
    stop: async () => {
      if (child.exitCode == null) child.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode == null) child.kill('SIGKILL');
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function jar(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}
function headers(base, cookie, more) {
  return { Origin: base, 'Sec-Fetch-Site': 'same-origin', ...(cookie ? { Cookie: cookie } : {}), ...more };
}
async function csrf(base, cookie) {
  const html = await (await fetch(base + '/', { headers: headers(base, cookie) })).text();
  const m = html.match(/id="fs-server">([^<]*)<\/script>/);
  assert.ok(m, 'shelf page did not include the session tag');
  return JSON.parse(m[1]);
}

test('first visit creates an account, then sign-in, saves, and password changes work', async () => {
  const app = await start();
  try {
    const home = await fetch(app.base + '/', { redirect: 'manual' });
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/setup');
    const open = await fetch(app.base + '/login', { redirect: 'manual' });
    assert.equal(open.headers.get('location'), '/setup');

    const bad = await fetch(app.base + '/setup', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ display: 'Max', username: 'max', password: 'short', confirm: 'short' }),
    });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /at least 8/);

    const made = await fetch(app.base + '/setup', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ display: 'Max', username: 'max', password: 'correct horse', confirm: 'correct horse' }),
    });
    assert.equal(made.status, 303);
    assert.equal(made.headers.get('location'), '/');
    const cookie = jar(made);
    assert.match(cookie, /fs_sid=/);

    const srv = await csrf(app.base, cookie);
    assert.equal(srv.user, 'max');
    assert.equal(srv.name, 'Max');
    const state = {
      version: 1, brands: ['Elegoo'], settings: { lowAt: 1, lowGrams: 200 },
      spools: [{ id: 's1', brand: 'Elegoo', material: 'PETG', colorName: 'Sky Blue', hex: '#3A9FE0', count: 2, weight: 1000, remaining: 180, location: 'Drybox', notes: '', price: 18 }],
    };
    const save = await fetch(app.base + '/api/state', {
      method: 'PUT',
      headers: headers(app.base, cookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }),
      body: JSON.stringify({ baseRev: srv.rev, state }),
    });
    assert.equal(save.status, 200);
    const got = await (await fetch(app.base + '/api/state', { headers: headers(app.base, cookie) })).json();
    assert.equal(got.state.spools[0].remaining, 180);
    assert.equal(got.state.spools[0].location, 'Drybox');

    const clash = await fetch(app.base + '/api/state', {
      method: 'PUT',
      headers: headers(app.base, cookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }),
      body: JSON.stringify({ baseRev: srv.rev, state }),
    });
    assert.equal(clash.status, 409);

    const again = await fetch(app.base + '/login', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ username: 'max', password: 'correct horse' }),
    });
    const other = jar(again);
    assert.equal(again.status, 303);

    const others = await fetch(app.base + '/api/account/sessions', {
      method: 'POST',
      headers: headers(app.base, cookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }),
      body: JSON.stringify({ others: true }),
    });
    assert.equal(others.status, 200);
    const kept = await fetch(app.base + '/', { headers: headers(app.base, cookie), redirect: 'manual' });
    assert.equal(kept.status, 200);
    const signedOut = await fetch(app.base + '/', { headers: headers(app.base, other), redirect: 'manual' });
    assert.equal(signedOut.status, 303);

    const changed = await fetch(app.base + '/api/account/password', {
      method: 'POST',
      headers: headers(app.base, cookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }),
      body: JSON.stringify({ current: 'correct horse', next: 'new password' }),
    });
    assert.equal(changed.status, 200);
    const still = await fetch(app.base + '/', { headers: headers(app.base, cookie), redirect: 'manual' });
    assert.equal(still.status, 200);
    const dropped = await fetch(app.base + '/', { headers: headers(app.base, other), redirect: 'manual' });
    assert.equal(dropped.status, 303);
    assert.equal(dropped.headers.get('location'), '/login');

    const old = await fetch(app.base + '/login', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ username: 'max', password: 'correct horse' }),
    });
    assert.equal(old.status, 401);
    const newer = await fetch(app.base + '/login', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ username: 'max', password: 'new password' }),
    });
    assert.equal(newer.status, 303);

    const closed = await fetch(app.base + '/setup', { redirect: 'manual' });
    assert.equal(closed.headers.get('location'), '/login');
  } finally {
    await app.stop();
  }
});

test('the setup key blocks the first account until it matches', async () => {
  const app = await start({ SETUP_KEY: 'gate-key' });
  try {
    const refused = await fetch(app.base + '/setup', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ display: 'Max', username: 'max', password: 'correct horse', confirm: 'correct horse', setupKey: 'nope' }),
    });
    assert.equal(refused.status, 403);
    assert.match(await refused.text(), /setup key/);
    const ok = await fetch(app.base + '/setup', {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ display: 'Max', username: 'max', password: 'correct horse', confirm: 'correct horse', setupKey: 'gate-key' }),
    });
    assert.equal(ok.status, 303);
  } finally {
    await app.stop();
  }
});
