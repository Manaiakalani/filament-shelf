#!/usr/bin/env node
// Replace the shelf with a backup, safely. Accepts a file from backups/ or an Export from the app.
//   docker compose exec -T app node server/restore.mjs < backup.json
//   docker compose restart app
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELF_FILE, BACKUP_DIR, readJson, writeJsonAtomicSync } from './lib.mjs';
import { toShelf } from './shelf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(process.env.WEB_DIR || path.join(HERE, '..', 'web'));
const { normalize } = await import(path.join(WEB, 'validate.mjs'));
const die = (m) => { console.error(m); process.exit(1); };

if (process.stdin.isTTY) die('Pipe a backup file in, for example:\n  docker compose exec -T app node server/restore.mjs < backup.json');
let text = '';
for await (const chunk of process.stdin) { text += chunk; if (text.length > 4 * 1024 * 1024) die('That file is too big to be a Filament Shelf backup.'); }
let next;
try { next = toShelf(JSON.parse(text), normalize); } catch (e) { die('That is not a usable backup: ' + e.message); }

// Keep the current shelf as a backup first, and give the restored one a newer revision so open pages reload.
let current = null;
try { current = readJson(SHELF_FILE, null); } catch (e) { current = null; }
if (current) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  writeJsonAtomicSync(path.join(BACKUP_DIR, 'shelf-' + stamp + '-before-restore.json'), current);
}
const rev = Math.max(Number.isInteger(current && current.rev) ? current.rev : 0, next.rev) + 1;
writeJsonAtomicSync(SHELF_FILE, { rev, state: { ...next.state, updatedAt: Date.now() }, restoredAt: new Date().toISOString() });
console.log('Restored ' + next.state.spools.length + ' colors. Now run: docker compose restart app');
