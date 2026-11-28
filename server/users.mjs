#!/usr/bin/env node
// Manage sign-ins. Run inside the container:
//   docker compose exec app node server/users.mjs add marsh
//   docker compose exec app node server/users.mjs list | passwd <name> | signout <name> | remove <name>
import readline from 'node:readline';
import { USERS_FILE, readJson, writeJsonAtomicSync, hashPassword, USERNAME_RE, MIN_PASSWORD } from './lib.mjs';

const [cmd, rawName] = process.argv.slice(2);
const name = String(rawName || '').trim().toLowerCase();
const users = readJson(USERS_FILE, { users: {} });
users.users = users.users || {};
const die = (m) => { console.error(m); process.exit(1); };
const save = () => writeJsonAtomicSync(USERS_FILE, users);

function ask(q) {
  // Hidden input on a terminal; plain line from a pipe (e.g. echo pw | ...).
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let buf = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { buf += d; }); process.stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(q); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
async function newPassword() {
  const a = await ask('Password (at least ' + MIN_PASSWORD + ' characters): ');
  if (a.length < MIN_PASSWORD) die('Too short. Use at least ' + MIN_PASSWORD + ' characters; a few random words works well.');
  if (a.length > 1024) die('Too long.');
  if (process.stdin.isTTY) { const b = await ask('Type it again: '); if (a !== b) die('The passwords did not match.'); }
  return hashPassword(a);
}
const need = () => { if (!USERNAME_RE.test(name)) die('Give a username: 1–32 characters, letters, numbers, dot, dash or underscore.'); };

switch (cmd) {
  case 'add':
    need(); if (users.users[name]) die(name + ' already exists. Use passwd to change the password.');
    users.users[name] = { hash: await newPassword(), role: Object.keys(users.users).length ? 'member' : 'admin', changed: Date.now() }; save(); console.log('Added ' + name + '.'); break;
  case 'passwd':
    need(); if (!users.users[name]) die('No user named ' + name + '.');
    users.users[name] = { ...users.users[name], hash: await newPassword(), changed: Date.now() }; save(); console.log('Changed the password for ' + name + ' and signed them out everywhere.'); break;
  case 'signout':
    need(); if (!users.users[name]) die('No user named ' + name + '.');
    users.users[name].changed = Date.now(); save(); console.log('Signed ' + name + ' out on every device.'); break;
  case 'remove':
    need(); if (!users.users[name]) die('No user named ' + name + '.');
    delete users.users[name]; save(); console.log('Removed ' + name + '.'); break;
  case 'list': {
    const n = Object.keys(users.users);
    console.log(n.length ? n.map((id) => id + (users.users[id].role === 'admin' ? '\tadmin' : '')).join('\n') : 'No users yet. Add one with: node server/users.mjs add <name>');
    break;
  }
  default:
    console.log('Usage: node server/users.mjs add|passwd|signout|remove <name>   or   list'); process.exit(cmd ? 1 : 0);
}
