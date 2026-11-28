#!/usr/bin/env node
// Replace one shelf, or every shelf, from a backup. Accepts a shelves-*.json snapshot,
// an older shelf-*.json file, or an Export from the app.
//   docker compose exec -T app node server/restore.mjs < shelves-2026-11-27T09-00-00.json
//   docker compose exec -T app node server/restore.mjs kloey < shelf-2026-11-13T09-00-00.json
//   docker compose restart app
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELF_FILE, SHELVES_META, BACKUP_DIR, USERS_FILE, readJson, writeJsonAtomicSync, shelfFile, USERNAME_RE } from './lib.mjs';
import { toShelf } from './shelf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(process.env.WEB_DIR || path.join(HERE, '..', 'web'));
const { normalize } = await import(path.join(WEB, 'validate.mjs'));
const die = (m) => { console.error(m); process.exit(1); };

if (process.stdin.isTTY) die('Pipe a backup file in, for example:\n  docker compose exec -T app node server/restore.mjs < backup.json\n  docker compose exec -T app node server/restore.mjs kloey < backup.json');
let text = '';
for await (const chunk of process.stdin) { text += chunk; if (text.length > 4 * 1024 * 1024) die('That file is too big to be a Filament Shelf backup.'); }
let raw;
try { raw = JSON.parse(text); } catch (e) { die('That is not a usable backup: ' + e.message); }

const argUser = process.argv[2] ? String(process.argv[2]).trim().toLowerCase() : '';
if (argUser && !USERNAME_RE.test(argUser)) die('That username is not valid.');

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function accounts() {
  const all = readJson(USERS_FILE, { users: {} });
  return all.users || {};
}
function ownerName() {
  const meta = readJson(SHELVES_META, null);
  if (meta && USERNAME_RE.test(String(meta.owner || ''))) return String(meta.owner);
  const u = accounts();
  const names = Object.keys(u);
  return names.find((n) => u[n] && u[n].role === 'admin') || names[0] || '';
}
function keepCurrent(file, current, label) {
  if (!current) return 0;
  const when = stamp();
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const name = label
    ? 'shelves-' + when + '-' + label + '-before-restore.json'
    : 'shelf-' + when + '-before-restore.json';
  writeJsonAtomicSync(path.join(BACKUP_DIR, name), current);
  return Number.isInteger(current.rev) ? current.rev : 0;
}
function writeShelf(file, next, label) {
  let current = null;
  try { current = readJson(file, null); } catch (e) { current = null; }
  const prev = keepCurrent(file, current, label);
  const rev = Math.max(prev, next.rev) + 1;
  writeJsonAtomicSync(file, { rev, state: { ...next.state, updatedAt: Date.now() }, restoredAt: new Date().toISOString() });
  return next.state.spools.length;
}
function markMigrated(owner) {
  const meta = readJson(SHELVES_META, null);
  if (meta && meta.migrated) return;
  writeJsonAtomicSync(SHELVES_META, { migrated: true, owner: owner || '' });
}

const many = raw && raw.shelves && typeof raw.shelves === 'object' && !Array.isArray(raw.shelves) && !Array.isArray(raw.spools);
if (many) {
  const names = Object.keys(raw.shelves);
  if (!names.length) die('That backup has no shelves.');
  for (const user of names) {
    if (!USERNAME_RE.test(user)) die('A shelf name in that backup is not a username.');
    let next;
    try { next = toShelf(raw.shelves[user], normalize); }
    catch (e) { die(user + ': ' + e.message); }
    const n = writeShelf(shelfFile(user), next, user);
    console.log('Restored ' + user + ' (' + n + ' colors).');
  }
  markMigrated(ownerName() || names.find((n) => USERNAME_RE.test(n)) || '');
  console.log('Now run: docker compose restart app');
} else {
  let next;
  try { next = toShelf(raw, normalize); } catch (e) { die('That is not a usable backup: ' + e.message); }
  const names = Object.keys(accounts());
  if (!names.length && !argUser) {
    const n = writeShelf(SHELF_FILE, next, '');
    console.log('Restored ' + n + ' colors onto the shelf that the first account will claim.');
    console.log('Now run: docker compose restart app');
  } else {
    const user = argUser || ownerName();
    if (!USERNAME_RE.test(user)) die('Name the account to restore onto:\n  docker compose exec -T app node server/restore.mjs <username> < backup.json');
    const n = writeShelf(shelfFile(user), next, user);
    markMigrated(ownerName() || user);
    console.log('Restored ' + n + ' colors onto ' + user + '.');
    console.log('Now run: docker compose restart app');
  }
}
