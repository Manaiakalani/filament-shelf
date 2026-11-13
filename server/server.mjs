// Filament Shelf self-hosted server. Node built-ins only: no third-party runtime packages.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR, USERS_FILE, SESSIONS_FILE, SHELF_FILE, BACKUP_DIR,
  readJson, writeJsonAtomic, writeJsonAtomicSync, verifyPassword, hashPassword, USERNAME_RE,
  MIN_PASSWORD, setupKeyMatches, cleanDisplayName,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(process.env.WEB_DIR || path.join(HERE, '..', 'web'));
const { normalize } = await import(path.join(WEB, 'validate.mjs'));
const { cap, precheck, toShelf: wrapShelf } = await import('./shelf.mjs');
const toShelf = (raw) => wrapShelf(raw, normalize);

/* ---------------- config ---------------- */
const env = (k, d) => (process.env[k] == null || process.env[k] === '' ? d : process.env[k]);
const num = (k, d, lo, hi) => { const v = Number(env(k, d)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d; };
const PORT = num('PORT', 8080, 1, 65535);
const HOST = env('HOST', '0.0.0.0');
// COOKIE_SECURE=true forces Secure cookies. false forces plain cookies for http on your own Wi-Fi.
// Leave it unset and the cookie follows the request: https through Cloudflare, http on the LAN.
const COOKIE_FORCE = process.env.COOKIE_SECURE;
const TRUST_CF = env('TRUST_PROXY', '') === 'cloudflare'; // visitor IP comes from Cloudflare's CF-Connecting-IP header
const TRUST_ANY = TRUST_CF || env('TRUST_PROXY', '') === 'true';
const SESSION_DAYS = num('SESSION_DAYS', 30, 1, 365);
const PUBLIC_ORIGIN = env('PUBLIC_ORIGIN', '').replace(/\/+$/, '').toLowerCase(); // e.g. https://filament.example.com
const MAX_BODY = 2 * 1024 * 1024;

/* ---------------- logging ---------------- */
const clean = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------------- static files (fixed list read at startup; no paths from requests ever touch the disk) ---- */
const ASSETS = new Map();
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function addAsset(urlPath, file, immutable) {
  const body = fs.readFileSync(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const gz = /text|json|javascript|manifest/.test(type) ? zlib.gzipSync(body, { level: 9 }) : null;
  ASSETS.set(urlPath, { body, gz, type, etag: '"' + crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"',
    cache: immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
}
for (const f of fs.readdirSync(path.join(WEB, 'assets'))) addAsset('/assets/' + f, path.join(WEB, 'assets', f), /-[A-Za-z0-9]{8,}\.(js|css|woff2)$/.test(f));
for (const f of fs.readdirSync(path.join(HERE, 'public'))) addAsset('/assets/' + f, path.join(HERE, 'public', f), false);
addAsset('/manifest.webmanifest', path.join(WEB, 'manifest.webmanifest'), false);
const APP_CSS = [...ASSETS.keys()].find((k) => /^\/assets\/app-[a-f0-9]+\.css$/.test(k));
const INDEX = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(HERE, 'login.html'), 'utf8').replace('__APPCSS__', APP_CSS);
const SETUP = fs.readFileSync(path.join(HERE, 'setup.html'), 'utf8').replace('__APPCSS__', APP_CSS);
if (!INDEX.includes('__SERVER__') || !INDEX.includes('__DATA__')) throw new Error('web/index.html is missing its placeholders');

/* ---------------- users (re-read when the file changes, so the CLI works without a restart) ---------------- */
let usersCache = { mtime: -1, users: {} };
function users() {
  let m = 0;
  try { m = fs.statSync(USERS_FILE).mtimeMs; } catch (e) { m = 0; }
  if (m !== usersCache.mtime) {
    try { usersCache = { mtime: m, users: (readJson(USERS_FILE, { users: {} }).users) || {} }; }
    catch (e) { log('users.json could not be read, keeping the last good copy:', e.message); usersCache.mtime = m; }
  }
  return usersCache.users;
}
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex')); // equal work when the name is unknown

/* ---------------- sessions: only a SHA-256 of each token is stored ---------------- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let sessions = {};
try { sessions = readJson(SESSIONS_FILE, {}) || {}; } catch (e) { log('sessions.json was unreadable; starting with everyone signed out.'); sessions = {}; }
let sessionsDirty = false;
function pruneSessions() {
  const now = Date.now(), u = users();
  for (const [k, s] of Object.entries(sessions)) if (!s || s.exp < now || !u[s.user] || s.created < (u[s.user].changed || 0)) { delete sessions[k]; sessionsDirty = true; }
}
// Session-file writes run one at a time, each writing the latest state, so an older write can never land last.
let sessionChain = Promise.resolve();
function flushSessions() {
  sessionChain = sessionChain.then(async () => { if (!sessionsDirty) return; sessionsDirty = false; await writeJsonAtomic(SESSIONS_FILE, { ...sessions }); })
    .catch((e) => { sessionsDirty = true; log('session save failed', e.message); });
  return sessionChain;
}
pruneSessions(); await flushSessions();
setInterval(() => { try { pruneSessions(); flushSessions(); } catch (e) { log('session cleanup failed', e.message); } }, 60 * 60 * 1000).unref();

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
function requestSecure(req) {
  if (COOKIE_FORCE === 'true') return true;
  if (COOKIE_FORCE === 'false') return false;
  if (req.socket && req.socket.encrypted) return true;
  if (!TRUST_ANY) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  try { return JSON.parse(req.headers['cf-visitor'] || '{}').scheme === 'https'; } catch (e) { return false; }
}
function sidName(req) { return requestSecure(req) ? '__Host-fs_sid' : 'fs_sid'; }
function devName(req) { return requestSecure(req) ? '__Host-fs_dev' : 'fs_dev'; }
function setCookie(req, name, val, maxAge) {
  return name + '=' + val + '; Path=/; HttpOnly; SameSite=Lax' + (requestSecure(req) ? '; Secure' : '') + '; Max-Age=' + maxAge;
}
function clearSessionCookies() {
  return [
    '__Host-fs_sid=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    'fs_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  ];
}
function sessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const tok = cookies[sidName(req)] || cookies['__Host-fs_sid'] || cookies.fs_sid;
  return tok && /^[A-Za-z0-9_-]{43}$/.test(tok) ? tok : '';
}
function getSession(req) {
  const tok = sessionToken(req);
  if (!tok) return null;
  const s = sessions[sha(tok)];
  if (!s) return null;
  const u = users()[s.user];
  if (s.exp < Date.now() || !u || s.created < (u.changed || 0)) { delete sessions[sha(tok)]; sessionsDirty = true; flushSessions(); return null; }
  return { ...s, key: sha(tok) };
}
async function createSession(user) {
  const tok = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions[sha(tok)] = { user, csrf: crypto.randomBytes(32).toString('base64url'), created: now, exp: now + SESSION_DAYS * 864e5 };
  sessionsDirty = true; await flushSessions();
  return tok;
}
function needsSetup() { return Object.keys(users()).length === 0; }
// Two people opening the first-run page at once must not each create an account.
let setupChain = Promise.resolve();
function enqueueSetup(fn) {
  const run = setupChain.then(fn, fn);
  setupChain = run.then(() => {}, () => {});
  return run;
}

// The CSRF token is sent masked with fresh random bytes on every page, so compressed pages never repeat it.
function maskCsrf(t) { const raw = Buffer.from(t, 'base64url'), m = crypto.randomBytes(raw.length); return Buffer.concat([m, raw.map((b, i) => b ^ m[i])]).toString('base64url'); }
function csrfOk(req, s) {
  const v = String(req.headers['x-csrf-token'] || '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(v)) return false;
  const buf = Buffer.from(v, 'base64url'), want = Buffer.from(s.csrf, 'base64url');
  if (buf.length !== want.length * 2) return false;
  const got = Buffer.from(buf.subarray(want.length).map((b, i) => b ^ buf[i]));
  return crypto.timingSafeEqual(got, want);
}

/* ---------------- request origin checks ---------------- */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (TRUST_CF && typeof cf === 'string' && cf.length < 64) return cf;
  return req.socket.remoteAddress || '?';
}
function sameOrigin(req) {
  // Current browsers mark every request with Sec-Fetch-Site, which a web page cannot change.
  // Only a request made by this site's own pages counts. Older browsers fall back to the Origin header.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return false;
  const o = origin.toLowerCase();
  if (PUBLIC_ORIGIN) return o === PUBLIC_ORIGIN;
  const host = String(req.headers.host || '').toLowerCase();
  return o === 'https://' + host || o === 'http://' + host;
}

/* ---------------- sign-in throttling ----------------
   Three counters, each over 15 minutes:
   - per IP (an IPv6 /64 counts as one): 10 misses, then that IP waits 15 minutes;
   - per username + IP: 5 misses, then a growing wait for that pair;
   - per username from anywhere: 20 misses, then a growing wait, except on devices that signed in
     before (they carry a signed "known device" cookie), so a stranger can't lock you out of your own phone. */
const WINDOW = 15 * 60 * 1000;
const ipFails = new Map(), pairFails = new Map(), nameFails = new Map();
const ipKey = (ip) => (ip.includes(':') ? ip.replace(/^::ffff:/, '').split(':').slice(0, 4).join(':') + '::/64' : ip);
function bucket(map, key, limit, fixedWait) {
  return {
    wait(now) { const b = map.get(key); return b && b.until > now ? Math.ceil((b.until - now) / 1000) : 0; },
    fail(now) {
      const b = map.get(key) || { n: 0, first: now, until: 0 };
      if (now - b.first > WINDOW && b.until < now) { b.n = 0; b.first = now; }
      b.n++;
      if (b.n >= limit) b.until = now + (fixedWait ? WINDOW : Math.min(WINDOW, 1000 * 2 ** Math.min(b.n - limit + 1, 10)));
      map.set(key, b);
    },
  };
}
function counters(ip, name) {
  const k = ipKey(ip);
  return [bucket(ipFails, k, 10, true), bucket(pairFails, name + '\n' + k, 5, false), bucket(nameFails, name, 20, false)];
}
setInterval(() => {
  const now = Date.now();
  for (const m of [ipFails, pairFails, nameFails]) for (const [k, v] of m) if (v.until < now && now - v.first > WINDOW) m.delete(k);
}, 5 * 60 * 1000).unref();

// Known-device cookie: name + expiry, signed with a secret kept in /data.
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE); if (SECRET.length < 32) throw new Error('short'); }
catch (e) { SECRET = crypto.randomBytes(32); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function deviceCookie(req, name) {
  // A "|" separates the name because usernames may contain dots.
  const exp = Date.now() + 365 * 864e5, v = name + '|' + exp;
  return setCookie(req, devName(req), v + '.' + sign(v), 365 * 86400);
}
function knownDevice(req, name) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[devName(req)] || cookies['__Host-fs_dev'] || cookies.fs_dev;
  if (!raw) return false;
  const i = raw.lastIndexOf('.'); if (i < 0) return false;
  const v = raw.slice(0, i), mac = Buffer.from(raw.slice(i + 1)), want = Buffer.from(sign(v));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return false;
  const bar = v.lastIndexOf('|'); if (bar < 0) return false;
  return v.slice(0, bar) === name && Number(v.slice(bar + 1)) > Date.now();
}
let hashing = 0; // cap parallel scrypt work so a flood of sign-ins can't pin the CPU

/* ---------------- the shelf ---------------- */
let shelf;
try { const raw = readJson(SHELF_FILE, null); shelf = raw ? toShelf(raw) : null; }
catch (e) {
  console.error('\n' + SHELF_FILE + ' is not a usable shelf (' + e.message + ').\nRestore one with: docker compose exec -T app node server/restore.mjs < backup.json\nor move the file away to start fresh.\n');
  process.exit(1);
}
if (!shelf) {
  shelf = { rev: 1, state: cap(normalize(JSON.parse(fs.readFileSync(path.join(WEB, 'seed.json'), 'utf8')))) };
  writeJsonAtomicSync(SHELF_FILE, shelf);
  log('Started a new shelf with example spools in', DATA_DIR);
}
let lastBackup = 0;
async function backup() {
  if (Date.now() - lastBackup < 60 * 60 * 1000) return;
  lastBackup = Date.now();
  await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await writeJsonAtomic(path.join(BACKUP_DIR, 'shelf-' + stamp + '.json'), shelf);
  const all = (await fsp.readdir(BACKUP_DIR)).filter((f) => /^shelf-.*\.json$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 72))) await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
}
let writeChain = Promise.resolve();

/* ---------------- responses ---------------- */
const CSP = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'",
  "manifest-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'"].join('; ');
function headers(req, res, extra = {}) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  if (requestSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}
function send(req, res, status, body, type, extra = {}) {
  headers(req, res, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && /text|json/.test(type)) {
    buf = zlib.gzipSync(buf, { level: 6 }); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
  }
  res.writeHead(status, { 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const json = (req, res, status, obj, extra) => send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const redirect = (req, res, to, extra = {}) => { headers(req, res, { Location: to, 'Cache-Control': 'no-store', ...extra }); res.writeHead(303); res.end(); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonTag = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function loginPage(req, res, status, msg, name) {
  const parts = { __MSG__: msg ? '<p class="note warn" role="alert"><span>' + esc(msg) + '</span></p>' : '', __NAME__: esc(name || '') };
  const html = LOGIN.replace(/__MSG__|__NAME__/g, (k) => parts[k]);
  send(req, res, status, html, 'text/html; charset=utf-8');
}
function setupPage(req, res, status, msg, fields) {
  const parts = {
    __MSG__: msg ? '<p class="note warn" role="alert"><span>' + esc(msg) + '</span></p>' : '',
    __NAME__: esc((fields && fields.name) || ''),
    __DISPLAY__: esc((fields && fields.display) || ''),
  };
  const html = SETUP.replace(/__MSG__|__NAME__|__DISPLAY__/g, (k) => parts[k]);
  send(req, res, status, html, 'text/html; charset=utf-8');
}
function sessionCookies(req, tok, user) {
  return [setCookie(req, sidName(req), tok, SESSION_DAYS * 86400), deviceCookie(req, user)];
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (len > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); return; }
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------------- routes ---------------- */
async function handle(req, res) {
  let p;
  try { p = new URL(req.url, 'http://x').pathname; } catch (e) { return send(req, res, 400, 'Bad request', 'text/plain'); }
  if (!String(req.url).startsWith('/')) return send(req, res, 400, 'Bad request', 'text/plain');
  const m = req.method;

  if (p === '/healthz') return send(req, res, 200, 'ok', 'text/plain; charset=utf-8');

  if (ASSETS.has(p)) {
    if (m !== 'GET' && m !== 'HEAD') return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
    const a = ASSETS.get(p);
    headers(req, res, { 'Content-Type': a.type, 'Cache-Control': a.cache, ETag: a.etag, Vary: 'Accept-Encoding' });
    if (req.headers['if-none-match'] === a.etag) { res.writeHead(304); return res.end(); }
    const gz = a.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (gz) res.setHeader('Content-Encoding', 'gzip');
    const body = gz ? a.gz : a.body;
    res.writeHead(200, { 'Content-Length': body.length });
    return res.end(m === 'HEAD' ? undefined : body);
  }

  if (p === '/setup') {
    if (m === 'GET' || m === 'HEAD') return needsSetup() ? setupPage(req, res, 200) : redirect(req, res, getSession(req) ? '/' : '/login');
    if (m !== 'POST') return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, POST' });
    if (!sameOrigin(req)) return setupPage(req, res, 403, 'Open this page directly and try again.');
    if (!/^application\/x-www-form-urlencoded\b/.test(String(req.headers['content-type'] || ''))) return send(req, res, 415, 'Unsupported', 'text/plain');
    const form = new URLSearchParams(await readBody(req, 8192));
    const displayRaw = String(form.get('display') || '');
    const display = cleanDisplayName(displayRaw);
    const name = String(form.get('username') || '').trim().toLowerCase();
    const pw = String(form.get('password') || '');
    const fields = { name, display: displayRaw };
    if (!needsSetup()) return redirect(req, res, '/login');
    if (!display) return setupPage(req, res, 400, 'Use a name with letters and numbers, up to 40 characters.', fields);
    if (!USERNAME_RE.test(name)) return setupPage(req, res, 400, 'Use a username of 1–32 characters: letters, numbers, dot, dash or underscore.', fields);
    if (pw.length < MIN_PASSWORD) return setupPage(req, res, 400, 'Use at least ' + MIN_PASSWORD + ' characters.', fields);
    if (pw.length > 1024) return setupPage(req, res, 400, 'That password is too long.', fields);
    if (pw !== String(form.get('confirm') || '')) return setupPage(req, res, 400, 'The passwords did not match.', fields);
    if (!setupKeyMatches(form.get('setupKey'))) return setupPage(req, res, 403, 'That setup key does not match.', fields);
    if (hashing >= 4) return setupPage(req, res, 503, 'The server is busy. Try again in a moment.', fields);
    const created = await enqueueSetup(async () => {
      if (!needsSetup()) return false;
      hashing++;
      let hash;
      try { hash = await hashPassword(pw); } finally { hashing--; }
      if (!needsSetup()) return false;
      await writeJsonAtomic(USERS_FILE, { users: { [name]: { hash, name: display, changed: Date.now() } } });
      return true;
    });
    if (!created) return redirect(req, res, '/login');
    const tok = await createSession(name);
    log('setup', name, clean(clientIp(req)));
    return redirect(req, res, '/', { 'Set-Cookie': sessionCookies(req, tok, name) });
  }

  if (p === '/login') {
    if (needsSetup() && (m === 'GET' || m === 'HEAD')) return redirect(req, res, '/setup');
    if (m === 'GET' || m === 'HEAD') return getSession(req) ? redirect(req, res, '/') : loginPage(req, res, 200);
    if (m !== 'POST') return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, POST' });
    if (!sameOrigin(req)) { log('cross-site sign-in refused', clean(req.headers.origin || '-'), clean(req.headers['sec-fetch-site'] || '-')); return loginPage(req, res, 403, 'That sign-in came from somewhere else. Open this page directly and try again.'); }
    if (!/^application\/x-www-form-urlencoded\b/.test(String(req.headers['content-type'] || ''))) return send(req, res, 415, 'Unsupported', 'text/plain');
    const form = new URLSearchParams(await readBody(req, 4096));
    const name = String(form.get('username') || '').trim().toLowerCase().slice(0, 64);
    const pw = String(form.get('password') || '').slice(0, 1024);
    const ip = clientIp(req), now = Date.now();
    const [byIp, byPair, byName] = counters(ip, name);
    const wait = Math.max(byIp.wait(now), byPair.wait(now), knownDevice(req, name) ? 0 : byName.wait(now));
    if (wait) { log('login throttled', clean(name), clean(ip)); return loginPage(req, res, 429, 'Too many tries. Wait ' + Math.ceil(wait / 60) + ' minute' + (wait > 60 ? 's' : '') + ' and try again.', name); }
    if (hashing >= 4) return loginPage(req, res, 503, 'The server is busy. Try again in a moment.', name);
    const u = USERNAME_RE.test(name) ? users()[name] : null;
    hashing++;
    let ok = false;
    try { ok = await verifyPassword(pw, u ? u.hash : DUMMY_HASH); } catch (e) { ok = false; } finally { hashing--; }
    if (!u || !ok) { byIp.fail(now); byPair.fail(now); byName.fail(now); log('login failed', clean(name), clean(ip)); return loginPage(req, res, 401, 'Wrong username or password.', name); }
    pairFails.delete(name + '\n' + ipKey(ip));
    const tok = await createSession(name);
    log('login', name, clean(ip));
    return redirect(req, res, '/', { 'Set-Cookie': sessionCookies(req, tok, name) });
  }

  const s = getSession(req);

  if (p === '/logout') {
    if (m !== 'POST') return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'POST' });
    if (s) {
      if (!sameOrigin(req) || !csrfOk(req, s)) return send(req, res, 403, 'Forbidden', 'text/plain');
      delete sessions[s.key]; sessionsDirty = true; await flushSessions();
    }
    return send(req, res, 204, '', 'text/plain', { 'Set-Cookie': clearSessionCookies() });
  }

  if (p === '/api/account/password' || p === '/api/account/sessions') {
    if (!s) return json(req, res, 401, { error: 'signed_out' });
    if (m !== 'POST') return json(req, res, 405, { error: 'method' }, { Allow: 'POST' });
    if (!sameOrigin(req) || !csrfOk(req, s)) return json(req, res, 403, { error: 'forbidden' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) return json(req, res, 415, { error: 'json_only' });
    let body;
    try { body = JSON.parse(await readBody(req, 8192)); }
    catch (e) { return json(req, res, e.status || 400, { error: e.status === 413 ? 'too_large' : 'bad_json' }); }
    const all = readJson(USERS_FILE, { users: {} });
    all.users = all.users || {};
    const record = all.users[s.user];
    if (!record) return json(req, res, 401, { error: 'signed_out' });
    const now = Date.now();
    if (p === '/api/account/sessions') {
      all.users[s.user] = { ...record, changed: now };
      await writeJsonAtomic(USERS_FILE, all);
      for (const [k, sess] of Object.entries(sessions)) if (k !== s.key && sess && sess.user === s.user) delete sessions[k];
      sessions[s.key].created = now; sessionsDirty = true; await flushSessions();
      log('signed out other devices', s.user);
      return json(req, res, 200, { ok: true });
    }
    const current = String(body.current || '').slice(0, 1024);
    const next = String(body.next || '');
    if (next.length < MIN_PASSWORD) return json(req, res, 400, { error: 'short' });
    if (next.length > 1024) return json(req, res, 400, { error: 'long' });
    const ip = clientIp(req), nowTry = Date.now();
    const [byIp, byPair] = counters(ip, s.user);
    const wait = Math.max(byIp.wait(nowTry), byPair.wait(nowTry));
    if (wait) return json(req, res, 429, { error: 'throttled' });
    if (hashing >= 4) return json(req, res, 503, { error: 'busy' });
    hashing++;
    let ok = false;
    try { ok = await verifyPassword(current, record.hash); } catch (e) { ok = false; } finally { hashing--; }
    if (!ok) { byIp.fail(nowTry); byPair.fail(nowTry); log('password change refused', s.user); return json(req, res, 401, { error: 'wrong_password' }); }
    hashing++;
    let hash;
    try { hash = await hashPassword(next); } finally { hashing--; }
    all.users[s.user] = { ...record, hash, changed: now };
    await writeJsonAtomic(USERS_FILE, all);
    for (const [k, sess] of Object.entries(sessions)) if (k !== s.key && sess && sess.user === s.user) delete sessions[k];
    sessions[s.key].created = now; sessionsDirty = true; await flushSessions();
    log('password changed', s.user);
    return json(req, res, 200, { ok: true });
  }

  if (p === '/' || p === '/index.html') {
    if (m !== 'GET' && m !== 'HEAD') return send(req, res, 405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });
    if (needsSetup()) return redirect(req, res, '/setup');
    if (!s) return redirect(req, res, '/login');
    const who = users()[s.user] || {};
    const parts = { __SERVER__: jsonTag({ rev: shelf.rev, csrf: maskCsrf(s.csrf), user: s.user, name: who.name || s.user }), __DATA__: jsonTag(shelf.state) };
    const html = INDEX.replace(/__SERVER__|__DATA__/g, (k) => parts[k]);
    return send(req, res, 200, html, 'text/html; charset=utf-8');
  }

  if (p === '/api/state') {
    if (!s) return json(req, res, 401, { error: 'signed_out' });
    if (m === 'GET') return json(req, res, 200, shelf);
    if (m !== 'PUT') return json(req, res, 405, { error: 'method' }, { Allow: 'GET, PUT' });
    if (!sameOrigin(req) || !csrfOk(req, s)) return json(req, res, 403, { error: 'forbidden' });
    if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) return json(req, res, 415, { error: 'json_only' });
    let body;
    try { body = JSON.parse(await readBody(req, MAX_BODY)); }
    catch (e) { return json(req, res, e.status || 400, { error: e.status === 413 ? 'too_large' : 'bad_json' }); }
    if (!body || !Number.isInteger(body.baseRev)) return json(req, res, 400, { error: 'bad_request' });
    let next;
    try { next = cap(normalize(precheck(body.state))); } catch (e) { return json(req, res, 422, { error: 'invalid', detail: String(e.message).slice(0, 200) }); }
    // One save at a time; a save based on an old copy is refused instead of overwriting newer changes.
    const result = writeChain.then(async () => {
      if (body.baseRev !== shelf.rev) return { status: 409, body: { error: 'conflict', rev: shelf.rev } };
      next.updatedAt = Date.now();
      await backup().catch((e) => log('backup failed', e.message));
      const saved = { rev: shelf.rev + 1, state: next, savedBy: s.user, savedAt: new Date().toISOString() };
      await writeJsonAtomic(SHELF_FILE, saved);
      shelf = saved;
      return { status: 200, body: { rev: shelf.rev } };
    });
    writeChain = result.catch(() => {});
    const r = await result;
    return json(req, res, r.status, r.body);
  }

  return send(req, res, 404, 'Not found', 'text/plain; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => { if (req.url !== '/healthz' && !String(req.url).startsWith('/assets/')) log(req.method, clean(req.url.split('?')[0]), res.statusCode, (Date.now() - t0) + 'ms', clean(clientIp(req))); });
  try { await handle(req, res); }
  catch (e) {
    log('error', e && e.stack || e);
    if (!res.headersSent) send(req, res, e.status || 500, e.status === 413 ? 'Too large' : 'Something went wrong', 'text/plain; charset=utf-8');
    else res.destroy();
  }
});
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 65000;
server.maxRequestsPerSocket = 1000;
server.listen(PORT, HOST, () => {
  const cookies = COOKIE_FORCE === 'true' ? 'on' : COOKIE_FORCE === 'false' ? 'off' : 'follow the request';
  log('Filament Shelf listening on ' + HOST + ':' + PORT + ' (data in ' + DATA_DIR + ', secure cookies ' + cookies + ')');
  if (needsSetup()) log('No account yet. Open the site to create one, or: docker compose exec app node server/users.mjs add <name>');
});
const stop = () => { server.close(() => flushSessions().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
