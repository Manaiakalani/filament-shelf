// Shared helpers: config, atomic JSON files, password hashing.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
export const INVITES_FILE = path.join(DATA_DIR, 'invites.json');
export const SHELF_FILE = path.join(DATA_DIR, 'shelf.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export const THEMES = ['system', 'light', 'dark'];
export const DISPLAY_FONTS = ['bricolage', 'fraunces', 'system'];
export const BODY_FONTS = ['instrument', 'nunito', 'system'];
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('Could not read ' + file + ': ' + e.message); }
}

// Write to a temp file, flush it to disk, then rename over the old file, so a crash never leaves half a file.
export async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  try {
    const fh = await fsp.open(tmp, 'w', 0o600);
    try { await fh.writeFile(JSON.stringify(value)); await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
}
export function writeJsonAtomicSync(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} throw e; }
}

// Stored string: scrypt$N$r$p$salt$key.
// N=16384, r=8, p=1, 16-byte salt, 32-byte key. verify reads N, r, p and the key
// length from the string, so an older hash still checks. The password is
// NFKC-normalized first, so look-alike characters match.
const N = 16384, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;
const scrypt = (pw, salt, n, r, p, len) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, len, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFKC'), salt, N, R, P, KEYLEN);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}
export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!n || !r || !p) return false;
  let salt, want;
  try { salt = Buffer.from(parts[4], 'base64'); want = Buffer.from(parts[5], 'base64'); }
  catch (e) { return false; }
  if (!salt.length || !want.length) return false;
  const got = await scrypt(String(pw).normalize('NFKC'), salt, n, r, p, want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Optional gate for the first-run page. Both sides are hashed so the compare
// does not leak the length of the key. An empty SETUP_KEY means no gate.
export function setupKeyMatches(given) {
  const expected = process.env.SETUP_KEY || '';
  if (!expected) return true;
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function cleanDisplayName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 40) return '';
  if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name)) return '';
  return name;
}

export const USERNAME_RE = /^[a-z0-9._-]{1,32}$/;
export const MIN_PASSWORD = 8;
