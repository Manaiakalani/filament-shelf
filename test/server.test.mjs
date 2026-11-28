import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/lib.mjs';

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
  const dir = extra.dir || await mkdtemp(path.join(tmpdir(), 'filament-shelf-'));
  if (typeof extra.prepare === 'function') await extra.prepare(dir);
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
    dir,
    log: () => log,
    stop: async () => {
      if (child.exitCode == null) {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise((r) => child.once('exit', r)),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
        if (child.exitCode == null) child.kill('SIGKILL');
      }
      if (!extra.keep) await rm(dir, { recursive: true, force: true });
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
    assert.equal(srv.role, 'admin');
    assert.equal(srv.shelves.length, 1);
    assert.equal(srv.shelves[0].user, 'max');
    const seeded = await (await fetch(app.base + '/api/state', { headers: headers(app.base, cookie) })).json();
    assert.ok(seeded.state.spools.length > 0);
    assert.equal(srv.theme, 'system');
    assert.equal(srv.displayFont, 'bricolage');
    assert.equal(srv.bodyFont, 'instrument');
    const page = await (await fetch(app.base + '/', { headers: headers(app.base, cookie) })).text();
    assert.match(page, /data-display="bricolage"/);
    assert.match(page, /data-body="instrument"/);
    assert.doesNotMatch(page, /data-theme=/);
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
    const mineFile = JSON.parse(readFileSync(path.join(app.dir, 'shelves', 'max.json'), 'utf8'));
    const sharedFile = JSON.parse(readFileSync(path.join(app.dir, 'shelf.json'), 'utf8'));
    assert.equal(mineFile.state.spools[0].location, 'Drybox');
    assert.notEqual(sharedFile.state.spools[0] && sharedFile.state.spools[0].location, 'Drybox');
    const meta = JSON.parse(readFileSync(path.join(app.dir, 'shelves.json'), 'utf8'));
    assert.equal(meta.migrated, true);
    assert.equal(meta.owner, 'max');

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

async function signUp(app, display, username, password) {
  const made = await fetch(app.base + '/setup', {
    method: 'POST', redirect: 'manual',
    headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ display, username, password, confirm: password }),
  });
  assert.equal(made.status, 303);
  return jar(made);
}

test('an admin can invite someone, and a member cannot manage people', async () => {
  const app = await start();
  try {
    const adminCookie = await signUp(app, 'Max', 'max', 'correct horse');
    const admin = await csrf(app.base, adminCookie);
    const jsonHeaders = (cookie, csrfToken) => headers(app.base, cookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken });

    const deniedBefore = await fetch(app.base + '/api/people', { headers: headers(app.base) });
    assert.equal(deniedBefore.status, 401);

    const created = await fetch(app.base + '/api/people', {
      method: 'POST',
      headers: jsonHeaders(adminCookie, admin.csrf),
      body: JSON.stringify({ display: 'Aroha', username: 'Aroha' }),
    });
    assert.equal(created.status, 201);
    const invite = await created.json();
    assert.match(invite.path, /^\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = invite.path.slice('/invite/'.length);
    assert.equal(app.log().includes(token), false);

    const replaced = await fetch(app.base + '/api/people', {
      method: 'POST',
      headers: jsonHeaders(adminCookie, admin.csrf),
      body: JSON.stringify({ display: 'Aroha', username: 'aroha' }),
    });
    assert.equal(replaced.status, 201);
    const fresh = await replaced.json();
    const freshToken = fresh.path.slice('/invite/'.length);
    assert.notEqual(freshToken, token);
    const stale = await fetch(app.base + '/invite/' + token);
    assert.equal(stale.status, 404);
    assert.match(await stale.text(), /expired/);

    const mismatch = await fetch(app.base + fresh.path, {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ password: 'spool shelf', confirm: 'other shelf' }),
    });
    assert.equal(mismatch.status, 400);
    const joined = await fetch(app.base + fresh.path, {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ password: 'spool shelf', confirm: 'spool shelf' }),
    });
    assert.equal(joined.status, 303);
    assert.equal(joined.headers.get('location'), '/');
    const memberCookie = jar(joined);
    const member = await csrf(app.base, memberCookie);
    assert.equal(member.user, 'aroha');
    assert.equal(member.role, 'member');
    const used = await fetch(app.base + fresh.path);
    assert.equal(used.status, 404);

    const forbidden = await fetch(app.base + '/api/people', { headers: headers(app.base, memberCookie) });
    assert.equal(forbidden.status, 403);
    const forbiddenWrite = await fetch(app.base + '/api/people', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ display: 'No', username: 'nope' }),
    });
    assert.equal(forbiddenWrite.status, 403);

    const badLook = await fetch(app.base + '/api/account/look', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ theme: 'neon', displayFont: 'bricolage', bodyFont: 'instrument' }),
    });
    assert.equal(badLook.status, 400);
    const look = await fetch(app.base + '/api/account/look', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ theme: 'dark', displayFont: 'fraunces', bodyFont: 'nunito' }),
    });
    assert.equal(look.status, 200);
    const themed = await fetch(app.base + '/', { headers: headers(app.base, memberCookie) });
    assert.equal(themed.status, 200);
    const html = await themed.text();
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /data-display="fraunces"/);
    assert.match(html, /data-body="nunito"/);
    const round = await fetch(app.base + '/api/account/look', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ theme: 'light', displayFont: 'quicksand', bodyFont: 'figtree' }),
    });
    assert.equal(round.status, 200);
    const roundHtml = await (await fetch(app.base + '/', { headers: headers(app.base, memberCookie) })).text();
    assert.match(roundHtml, /data-theme="light"/);
    assert.match(roundHtml, /data-display="quicksand"/);
    assert.match(roundHtml, /data-body="figtree"/);
    const titleOnly = await fetch(app.base + '/api/account/look', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ theme: 'dark', displayFont: 'fredoka', bodyFont: 'fredoka' }),
    });
    assert.equal(titleOnly.status, 400);
    const outfit = await fetch(app.base + '/api/account/look', {
      method: 'POST',
      headers: jsonHeaders(memberCookie, member.csrf),
      body: JSON.stringify({ theme: 'system', displayFont: 'outfit', bodyFont: 'outfit' }),
    });
    assert.equal(outfit.status, 200);

    const duplicate = await fetch(app.base + '/api/people', {
      method: 'POST',
      headers: jsonHeaders(adminCookie, admin.csrf),
      body: JSON.stringify({ display: 'Aroha', username: 'aroha' }),
    });
    assert.equal(duplicate.status, 409);
    const reset = await fetch(app.base + '/api/people/aroha/link', {
      method: 'POST',
      headers: jsonHeaders(adminCookie, admin.csrf),
      body: JSON.stringify({}),
    });
    assert.equal(reset.status, 201);
    const resetBody = await reset.json();
    const resetToken = resetBody.path.slice('/invite/'.length);
    assert.equal(app.log().includes(resetToken), false);
    assert.match(app.log(), /POST \/invite /);
    const resetPage = await (await fetch(app.base + resetBody.path)).text();
    assert.match(resetPage, /Choose a new password/);
    const resetDone = await fetch(app.base + resetBody.path, {
      method: 'POST', redirect: 'manual',
      headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ password: 'fresh spool', confirm: 'fresh spool' }),
    });
    assert.equal(resetDone.status, 303);
    const signedOut = await fetch(app.base + '/', { headers: headers(app.base, memberCookie), redirect: 'manual' });
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.headers.get('location'), '/login');
    const newer = jar(resetDone);
    const back = await fetch(app.base + '/', { headers: headers(app.base, newer), redirect: 'manual' });
    assert.equal(back.status, 200);

    const self = await fetch(app.base + '/api/people/max', {
      method: 'DELETE',
      headers: jsonHeaders(adminCookie, admin.csrf),
    });
    assert.equal(self.status, 400);
    assert.equal((await self.json()).error, 'self');

    const removed = await fetch(app.base + '/api/people/aroha', {
      method: 'DELETE',
      headers: jsonHeaders(adminCookie, admin.csrf),
    });
    assert.equal(removed.status, 200);
    const gone = await fetch(app.base + '/', { headers: headers(app.base, newer), redirect: 'manual' });
    assert.equal(gone.status, 303);

    const pending = await fetch(app.base + '/api/people', {
      method: 'POST',
      headers: jsonHeaders(adminCookie, admin.csrf),
      body: JSON.stringify({ display: 'Koa', username: 'koa' }),
    });
    const pendingBody = await pending.json();
    const dropped = await fetch(app.base + '/api/people/koa', {
      method: 'DELETE',
      headers: jsonHeaders(adminCookie, admin.csrf),
    });
    assert.equal(dropped.status, 200);
    const cancelled = await fetch(app.base + pendingBody.path);
    assert.equal(cancelled.status, 404);

    const oldToken = 'a'.repeat(43);
    const oldId = createHash('sha256').update(oldToken).digest('hex');
    writeFileSync(app.dir + '/invites.json', JSON.stringify({
      invites: { [oldId]: { user: 'old', name: 'Old', purpose: 'join', exp: Date.now() - 1000 } },
    }));
    const expired = await fetch(app.base + '/invite/' + oldToken);
    assert.equal(expired.status, 404);
    assert.match(await expired.text(), /expired/);
    assert.equal(app.log().includes(oldToken), false);
    assert.equal(app.log().includes(freshToken), false);
  } finally {
    await app.stop();
  }
});

function shelfBody(colorName, id) {
  return {
    version: 1, brands: ['Polymaker'], settings: { lowAt: 1, lowGrams: 200 }, hideSampleNote: true,
    spools: [{ id, brand: 'Polymaker', material: 'PLA', colorName, hex: '#E4632A', count: 2, weight: 1000, notes: '', location: '' }],
  };
}

test('each account has its own shelf, and people can read each other', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'filament-shelf-'));
  const hash = await hashPassword('correct horse');
  writeFileSync(path.join(dir, 'users.json'), JSON.stringify({
    users: { manaiakalani: { hash, name: 'Max', role: 'admin', changed: 1 } },
  }));
  writeFileSync(path.join(dir, 'shelf.json'), JSON.stringify({
    rev: 7,
    state: shelfBody('Family Orange', 'live'),
  }));
  const app = await start({ dir, keep: true });
  try {
    const login = async (running, username, password) => {
      const res = await fetch(running.base + '/login', {
        method: 'POST', redirect: 'manual',
        headers: headers(running.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ username, password }),
      });
      assert.equal(res.status, 303, running.log());
      return jar(res);
    };
    let adminCookie = await login(app, 'manaiakalani', 'correct horse');
    let admin = await csrf(app.base, adminCookie);
    let mine = await (await fetch(app.base + '/api/state', { headers: headers(app.base, adminCookie) })).json();
    assert.equal(mine.state.spools[0].colorName, 'Family Orange');
    assert.equal(mine.rev, 7);
    const meta = JSON.parse(readFileSync(path.join(dir, 'shelves.json'), 'utf8'));
    assert.equal(meta.migrated, true);
    assert.equal(meta.owner, 'manaiakalani');

    const save = await fetch(app.base + '/api/state', {
      method: 'PUT',
      headers: headers(app.base, adminCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }),
      body: JSON.stringify({ baseRev: mine.rev, state: shelfBody('Only Max', 'max-1') }),
    });
    assert.equal(save.status, 200);
    writeFileSync(path.join(dir, 'shelf.json'), JSON.stringify({ rev: 99, state: shelfBody('Should Not Return', 'nope') }));
    await app.stop();

    const again = await start({ dir, keep: true });
    try {
      adminCookie = await login(again, 'manaiakalani', 'correct horse');
      admin = await csrf(again.base, adminCookie);
      mine = await (await fetch(again.base + '/api/state', { headers: headers(again.base, adminCookie) })).json();
      assert.equal(mine.state.spools[0].colorName, 'Only Max');
      assert.notEqual(mine.state.spools[0].colorName, 'Should Not Return');

      const created = await fetch(again.base + '/api/people', {
        method: 'POST',
        headers: headers(again.base, adminCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }),
        body: JSON.stringify({ display: 'Kloey', username: 'kloey' }),
      });
      assert.equal(created.status, 201);
      const invite = await created.json();
      const joined = await fetch(again.base + invite.path, {
        method: 'POST', redirect: 'manual',
        headers: headers(again.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ password: 'spool shelf', confirm: 'spool shelf' }),
      });
      assert.equal(joined.status, 303);
      const kloeyCookie = jar(joined);
      const kloey = await csrf(again.base, kloeyCookie);
      const empty = await (await fetch(again.base + '/api/state', { headers: headers(again.base, kloeyCookie) })).json();
      assert.equal(empty.state.spools.length, 0);

      const seen = await (await fetch(again.base + '/api/shelves/manaiakalani', { headers: headers(again.base, kloeyCookie) })).json();
      assert.equal(seen.state.spools[0].colorName, 'Only Max');
      assert.equal(seen.name, 'Max');
      const listed = await (await fetch(again.base + '/api/shelves', { headers: headers(again.base, kloeyCookie) })).json();
      assert.deepEqual(listed.shelves.map((s) => s.user).sort(), ['kloey', 'manaiakalani']);
      assert.equal(JSON.stringify(listed).includes('hash'), false);
      assert.equal(JSON.stringify(listed).includes('scrypt'), false);

      const hers = await fetch(again.base + '/api/state', {
        method: 'PUT',
        headers: headers(again.base, kloeyCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': kloey.csrf }),
        body: JSON.stringify({ baseRev: empty.rev, state: shelfBody('Only Kloey', 'kloey-1'), owner: 'manaiakalani' }),
      });
      assert.equal(hers.status, 200);
      const maxAfter = await (await fetch(again.base + '/api/state', { headers: headers(again.base, adminCookie) })).json();
      assert.equal(maxAfter.state.spools[0].colorName, 'Only Max');
      const maxSees = await (await fetch(again.base + '/api/shelves/kloey', { headers: headers(again.base, adminCookie) })).json();
      assert.equal(maxSees.state.spools[0].colorName, 'Only Kloey');
      assert.equal(maxSees.name, 'Kloey');

      const missing = await fetch(again.base + '/api/shelves/nobody', { headers: headers(again.base, adminCookie) });
      assert.equal(missing.status, 404);
      const sneak = await fetch(again.base + '/api/shelves/' + encodeURIComponent('../users'), { headers: headers(again.base, adminCookie) });
      assert.equal(sneak.status, 404);
      const refused = await fetch(again.base + '/api/shelves/manaiakalani', {
        method: 'PUT',
        headers: headers(again.base, kloeyCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': kloey.csrf }),
        body: JSON.stringify({ baseRev: seen.rev, state: shelfBody('Nope', 'x') }),
      });
      assert.equal(refused.status, 405);
      const signedOut = await fetch(again.base + '/api/shelves');
      assert.equal(signedOut.status, 401);

      const removed = await fetch(again.base + '/api/people/kloey', {
        method: 'DELETE',
        headers: headers(again.base, adminCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }),
      });
      assert.equal(removed.status, 200);
      assert.equal(existsSync(path.join(dir, 'shelves', 'kloey.json')), true);
      const hidden = await fetch(again.base + '/api/shelves/kloey', { headers: headers(again.base, adminCookie) });
      assert.equal(hidden.status, 404);
      const names = await (await fetch(again.base + '/api/shelves', { headers: headers(again.base, adminCookie) })).json();
      assert.equal(names.shelves.some((s) => s.user === 'kloey'), false);

      const relink = await fetch(again.base + '/api/people', {
        method: 'POST',
        headers: headers(again.base, adminCookie, { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf }),
        body: JSON.stringify({ display: 'Kloey', username: 'kloey' }),
      });
      assert.equal(relink.status, 201);
      const link = await relink.json();
      const back = await fetch(again.base + link.path, {
        method: 'POST', redirect: 'manual',
        headers: headers(again.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ password: 'spool shelf', confirm: 'spool shelf' }),
      });
      assert.equal(back.status, 303);
      const restored = await (await fetch(again.base + '/api/state', { headers: headers(again.base, jar(back)) })).json();
      assert.equal(restored.state.spools[0].colorName, 'Only Kloey');
    } finally {
      await again.stop();
    }
  } finally {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

function runRestore(dir, args, json) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server/restore.mjs', ...args], {
      cwd: root,
      env: { PATH: process.env.PATH || '', DATA_DIR: dir, WEB_DIR: web },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify(json));
  });
}

test('restore writes one account or every account, and leaves the old shared file for a fresh box', async () => {
  const fresh = await mkdtemp(path.join(tmpdir(), 'filament-shelf-'));
  try {
    const bare = await runRestore(fresh, [], shelfBody('First shelf', 's1'));
    assert.equal(bare.code, 0, bare.err);
    const shared = JSON.parse(readFileSync(path.join(fresh, 'shelf.json'), 'utf8'));
    assert.equal(shared.state.spools[0].colorName, 'First shelf');
    assert.equal(existsSync(path.join(fresh, 'shelves.json')), false);
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'filament-shelf-'));
  try {
    const hash = await hashPassword('correct horse');
    writeFileSync(path.join(dir, 'users.json'), JSON.stringify({
      users: {
        manaiakalani: { hash, name: 'Max', role: 'admin', changed: 1 },
        kloey: { hash, name: 'Kloey', role: 'member', changed: 1 },
      },
    }));
    writeFileSync(path.join(dir, 'shelves.json'), JSON.stringify({ migrated: true, owner: 'manaiakalani' }));
    const one = await runRestore(dir, ['kloey'], shelfBody('Kloey restored', 'k1'));
    assert.equal(one.code, 0, one.err);
    assert.match(one.out, /onto kloey/);
    const kloey = JSON.parse(readFileSync(path.join(dir, 'shelves', 'kloey.json'), 'utf8'));
    assert.equal(kloey.state.spools[0].colorName, 'Kloey restored');

    const many = await runRestore(dir, [], {
      shelves: {
        manaiakalani: { rev: 3, state: shelfBody('Max restored', 'm1') },
        kloey: { rev: 4, state: shelfBody('Kloey again', 'k2') },
      },
    });
    assert.equal(many.code, 0, many.err);
    const max = JSON.parse(readFileSync(path.join(dir, 'shelves', 'manaiakalani.json'), 'utf8'));
    const kloeyAgain = JSON.parse(readFileSync(path.join(dir, 'shelves', 'kloey.json'), 'utf8'));
    assert.equal(max.state.spools[0].colorName, 'Max restored');
    assert.equal(kloeyAgain.state.spools[0].colorName, 'Kloey again');
    assert.ok(kloeyAgain.rev > kloey.rev);

    const app = await start({ dir, keep: true });
    try {
      const res = await fetch(app.base + '/login', {
        method: 'POST', redirect: 'manual',
        headers: headers(app.base, '', { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: new URLSearchParams({ username: 'kloey', password: 'correct horse' }),
      });
      assert.equal(res.status, 303);
      const got = await (await fetch(app.base + '/api/state', { headers: headers(app.base, jar(res)) })).json();
      assert.equal(got.state.spools[0].colorName, 'Kloey again');
    } finally {
      await app.stop();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
