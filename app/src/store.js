// Persistence: embedded JSON tag + localStorage + optional artifact publish.
const LS_KEY = 'filament-shelf-v1';
const TAG_ID = 'filament-data';
const OPEN = '<script type="application/json" id="' + TAG_ID + '">';
const CLOSE = '</' + 'script>';

// Snapshot of the pristine document, taken before React mounts (see main.jsx).
let SHELL = '';
export function captureShell() {
  try { SHELL = '<!DOCTYPE html>\n' + document.documentElement.outerHTML; window.__SHELL__ = SHELL; } catch (e) { SHELL = ''; }
}

export const uid = () => 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function cleanUrl(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  if (!/^https?:\/\//i.test(url)) return '';
  return url.slice(0, 200);
}

// One reorder note per brand. A link has to be http(s). Empty notes are dropped.
export function cleanShops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const brand = String(row.brand || '').trim().slice(0, 80);
    const key = brand.toLowerCase();
    if (!brand || seen.has(key)) continue;
    const note = String(row.note || '').trim().slice(0, 120);
    const url = cleanUrl(row.url);
    if (!note && !url) continue;
    seen.add(key);
    out.push({ brand, note, url });
  }
  return out.slice(0, 100);
}

export function withShop(settings, brand, note, url) {
  const base = settings && typeof settings === 'object' ? settings : {};
  const key = String(brand || '').trim().toLowerCase();
  const rest = (base.shops || []).filter((s) => String(s.brand || '').trim().toLowerCase() !== key);
  return { ...base, shops: cleanShops([...rest, { brand, note, url }]) };
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a Filament Shelf backup.');
  if (!Array.isArray(raw.spools)) throw new Error('The backup has no "spools" list.');
  const spools = raw.spools.map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error('Spool ' + (i + 1) + ' is not readable.');
    let hex = String(s.hex || '').trim();
    if (/^[0-9a-f]{6}$/i.test(hex)) hex = '#' + hex;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#888888';
    const count = Math.max(0, Math.floor(Number(s.count) || 0));
    const pr = s.price === '' || s.price == null ? NaN : Number(String(s.price).replace(/[^0-9.\-]/g, ''));
    const wt = Number(String(s.weight == null ? '' : s.weight).replace(/[^0-9.]/g, ''));
    const weight = wt > 0 && wt < 100000 ? Math.round(wt) : 1000;
    const o = {
      id: s.id ? String(s.id) : uid(),
      brand: String(s.brand || 'Unbranded').trim() || 'Unbranded',
      material: String(s.material || 'PLA').trim() || 'PLA',
      colorName: String(s.colorName || s.color || 'Unnamed').trim() || 'Unnamed',
      hex: hex.toUpperCase(), count, notes: String(s.notes || ''),
      location: String(s.location || '').trim().slice(0, 40),
      price: Number.isFinite(pr) && pr >= 0 ? Math.round(pr * 100) / 100 : null,
      weight,
    };
    if (count > 0 && s.remaining != null && s.remaining !== '') {
      const left = Number(String(s.remaining).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(left) && left >= 0) o.remaining = Math.min(weight, Math.round(left));
    }
    if (s.isSample) o.isSample = true;
    return o;
  });
  const brands = [], seen = new Set();
  const add = (b) => { b = String(b || '').trim(); const k = b.toLowerCase(); if (b && !seen.has(k)) { seen.add(k); brands.push(b); } };
  (Array.isArray(raw.brands) ? raw.brands : []).forEach(add);
  spools.forEach((s) => add(s.brand));
  const low = Math.floor(Number(raw.settings && raw.settings.lowAt));
  const grams = Math.floor(Number(raw.settings && raw.settings.lowGrams));
  const out = { version: 1, brands, spools, updatedAt: Number(raw.updatedAt) || 0, settings: {
    lowAt: Number.isFinite(low) ? Math.min(20, Math.max(0, low)) : 1,
    lowGrams: Number.isFinite(grams) ? Math.min(2000, Math.max(0, grams)) : 200,
    shops: cleanShops(raw.settings && raw.settings.shops),
  } };
  if (raw.hideSampleNote) out.hideSampleNote = true;
  return out;
}

/* ---------- self-hosted server mode ----------
   The server adds <script type="application/json" id="fs-server">{"rev":n,"csrf":"…","user":"…"}</script>.
   Then the server holds the shelf: nothing is kept in this browser's storage. */
let SRV;
export function server() {
  if (SRV !== undefined) return SRV;
  SRV = null;
  try {
    const el = typeof document !== 'undefined' && document.getElementById('fs-server');
    if (el) { const v = JSON.parse(el.textContent); if (v && typeof v.csrf === 'string') SRV = v; }
  } catch (e) { SRV = null; }
  return SRV;
}
// Unsaved edits wait in this tab's sessionStorage until the server confirms them, so a reload,
// an expired sign-in or a dropped connection doesn't lose them. Cleared on sign-out.
const pendKey = () => 'fs-pending:' + (server() ? server().user : '');
function readPending() { try { const v = JSON.parse(sessionStorage.getItem(pendKey())); return v && v.state ? v : null; } catch (e) { return null; } }
function writePending(state) { try { sessionStorage.setItem(pendKey(), JSON.stringify({ baseRev: server().rev, state })); } catch (e) {} }
function clearPending(updatedAt) { try { const p = readPending(); if (!p || updatedAt == null || p.state.updatedAt === updatedAt) sessionStorage.removeItem(pendKey()); } catch (e) {} }
// What the page started with: 'clean', 'pending' (an unsaved edit to send) or 'conflict' (an edit made against an older shelf).
let BOOT = 'clean';
export const bootStatus = () => BOOT;

const pick = (state) => ({ version: 1, brands: state.brands, spools: state.spools, settings: state.settings, hideSampleNote: !!state.hideSampleNote, updatedAt: state.updatedAt });
async function serverSave(state) {
  const srv = server();
  let r;
  try {
    r = await fetch('/api/state', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }, body: JSON.stringify({ baseRev: srv.rev, state: pick(state) }) });
  } catch (e) { return 'error'; }
  // A redirect here means Cloudflare Access (or the app) wants a fresh sign-in.
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 0) return 'signedout';
  if (r.status === 409) return 'conflict';
  if (r.status >= 500) return 'error';
  if (!r.ok) return 'rejected';
  try { const j = await r.json(); if (Number.isInteger(j.rev)) srv.rev = j.rev; } catch (e) {}
  clearPending(state.updatedAt);
  return 'published';
}
// Latest copy from the server, for refreshing when the app comes back to the foreground.
export async function fetchLatest() {
  const srv = server(); if (!srv) return null;
  let r;
  try { r = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store', redirect: 'manual' }); } catch (e) { return null; }
  if (r.type === 'opaqueredirect' || r.status === 401) return { signedOut: true };
  if (!r.ok) return null;
  try { const j = await r.json(); return Number.isInteger(j.rev) ? { rev: j.rev, state: normalize(j.state) } : null; } catch (e) { return null; }
}
export function adoptRev(rev) { if (server() && Number.isInteger(rev)) server().rev = rev; }
export function dropPending() { try { sessionStorage.removeItem(pendKey()); } catch (e) {} }
export async function signOut() {
  const srv = server(); if (!srv) return;
  dropPending();
  try { await fetch('/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': srv.csrf } }); } catch (e) {}
  window.location.assign('/login');
}
async function postAccount(path, body) {
  const srv = server();
  if (!srv) return 'local';
  let r;
  try {
    r = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf }, body: JSON.stringify(body) });
  } catch (e) { return 'error'; }
  if (r.type === 'opaqueredirect' || r.status === 401) {
    try { const j = await r.json(); if (j && j.error === 'wrong_password') return 'wrong'; } catch (e) {}
    return 'signedout';
  }
  if (r.status === 400) return 'short';
  if (!r.ok) return 'error';
  return 'ok';
}
export function changePassword(current, next) { return postAccount('/api/account/password', { current, next }); }
export function signOutOthers() { return postAccount('/api/account/sessions', { others: true }); }

export function applyLook(look) {
  if (typeof document === 'undefined' || !look) return;
  const root = document.documentElement;
  if (look.theme === 'light' || look.theme === 'dark') root.dataset.theme = look.theme;
  else delete root.dataset.theme;
  if (look.displayFont) root.dataset.display = look.displayFont;
  if (look.bodyFont) root.dataset.body = look.bodyFont;
  let dark = look.theme === 'dark';
  if (look.theme !== 'light' && look.theme !== 'dark') {
    try { dark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { dark = false; }
  }
  const color = dark ? '#11131A' : '#C9D0DB';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}
export function rememberLook(look) {
  const srv = server();
  if (srv) Object.assign(srv, look);
  applyLook(look);
}
export async function apiJson(path, method, body) {
  const srv = server();
  if (!srv) return { ok: false, error: 'local' };
  let r;
  try {
    r = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': srv.csrf },
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : JSON.stringify(body || {}),
    });
  } catch (e) { return { ok: false, error: 'error' }; }
  if (r.type === 'opaqueredirect' || r.status === 401) return { ok: false, error: 'signedout' };
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) return { ok: false, status: r.status, error: data.error || 'error' };
  return { ok: true, ...data };
}
try { const bootLook = server(); if (bootLook) applyLook(bootLook); } catch (e) {}

export function loadInitial() {
  let embedded = null, local = null;
  try { embedded = normalize(JSON.parse(document.getElementById(TAG_ID).textContent)); } catch (e) {}
  if (server()) {
    const p = readPending();
    if (p) {
      try { const st = normalize(p.state); BOOT = p.baseRev === server().rev ? 'pending' : 'conflict'; return st; } catch (e) { dropPending(); }
    }
    return embedded || { version: 1, brands: [], spools: [], updatedAt: 0, settings: { lowAt: 1 } };
  }
  try { const t = localStorage.getItem(LS_KEY); if (t) local = normalize(JSON.parse(t)); } catch (e) {}
  if (embedded && local) return local.updatedAt > embedded.updatedAt ? local : embedded;
  return embedded || local || { version: 1, brands: [], spools: [], updatedAt: 0, settings: { lowAt: 1 } };
}

export function saveLocal(state) {
  if (server()) { writePending(state); return true; }
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

export async function getArtifact() {
  try {
    if (!window.claude) { await new Promise((r) => setTimeout(r, 300)); }
    return window.claude ? await window.claude.use('artifact') : null;
  } catch (e) { return null; }
}

export async function getDownloads() {
  if (server()) {
    return { save: async ({ filename, data }) => {
      const type = /\.csv$/i.test(filename) ? 'text/csv' : 'application/json';
      const url = URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } };
  }
  try { return window.claude ? await window.claude.use('downloads') : null; } catch (e) { return null; }
}

// Poll lightly for the host bridge (it can arrive after first script run).
export function waitForClaude(ms = 10000) {
  if (server()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.claude && typeof window.claude.use === 'function') return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}

export function buildHtml(state) {
  if (!SHELL) return null;
  const a = SHELL.indexOf(OPEN);
  if (a < 0) return null;
  const b = SHELL.indexOf(CLOSE, a + OPEN.length);
  if (b < 0) return null;
  const json = JSON.stringify(state).replace(/</g, '\\u003c');
  return SHELL.slice(0, a + OPEN.length) + json + SHELL.slice(b);
}

// Returns 'published' | 'local' | 'viewonly'
export async function publish(state) {
  if (server()) return serverSave(state);
  const artifact = await getArtifact();
  if (!artifact || typeof artifact.publish !== 'function') return 'local';
  const html = buildHtml(state);
  if (!html) return 'local';
  try { await artifact.publish(html); return 'published'; }
  catch (e) {
    const m = String((e && (e.code || e.name || '')) + ' ' + (e && e.message || e));
    if (/conflict/i.test(m)) return 'published';
    if (/not_granted|not_writer/i.test(m)) return 'viewonly';
    return 'local';
  }
}


/* ---------- CSV ---------- */
const CSV_COLS = ['Brand', 'Material', 'Color', 'Hex', 'Spools', 'Location', 'Price', 'Spool size (g)', 'Grams left', 'Notes'];
const safeCell = (v) => { v = String(v == null ? '' : v); if (/^[=+@\-\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export function toCsv(state) {
  const rows = state.spools.map((s) => [s.brand, s.material, s.colorName, s.hex, s.count, s.location || '', s.price == null ? '' : s.price, s.weight || 1000, s.remaining == null ? '' : s.remaining, s.notes || ''].map(safeCell).join(','));
  return [CSV_COLS.join(','), ...rows].join('\n');
}
function parseCsvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('That looks empty. A CSV needs a header row and at least one spool.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const ix = {
    brand: find('brand', 'vendor', 'manufacturer'), material: find('material', 'type'), colorName: find('color name', 'colour', 'color', 'name'),
    hex: find('hex', 'color hex', 'colour hex'), count: find('spools', 'count', 'qty', 'quantity'), location: find('location', 'storage'),
    price: find('price', 'cost'), weight: find('spool size', 'weight', 'size'), remaining: find('grams left', 'remaining'), notes: find('notes', 'note'),
  };
  if (ix.colorName < 0 && ix.brand < 0) throw new Error('No Brand or Color column found. The first row should name the columns, like Brand, Material, Color, Spools.');
  const get = (r, k) => (ix[k] >= 0 && r[ix[k]] != null ? String(r[ix[k]]).trim().replace(/^'(?=[=+@\-])/, '') : '');
  const spools = rows.slice(1).map((r) => ({
    brand: get(r, 'brand'), material: get(r, 'material'), colorName: get(r, 'colorName'), hex: get(r, 'hex'),
    count: ix.count >= 0 ? get(r, 'count') : 1, location: get(r, 'location'), price: get(r, 'price'), weight: get(r, 'weight'), remaining: get(r, 'remaining'), notes: get(r, 'notes'),
  }));
  return normalize({ spools });
}
export function parseBackup(text) {
  const t = String(text).trim();
  if (t[0] === '{' || t[0] === '[') {
    const raw = JSON.parse(t);
    return normalize(Array.isArray(raw) ? { spools: raw } : raw);
  }
  return parseCsv(t);
}
export const spoolKey = (s) => [s.brand, s.material, s.colorName].map((x) => String(x).trim().toLowerCase()).join('|');

// Grams on the shelf. A missing remaining value means every spool of that color is full.
export function gramsOnHand(s) {
  const count = s.count || 0;
  const weight = s.weight || 1000;
  if (count <= 0) return 0;
  if (s.remaining == null) return count * weight;
  return (count - 1) * weight + s.remaining;
}
export function spoolValue(s) {
  if (s.price == null || (s.count || 0) <= 0) return 0;
  const weight = s.weight || 1000;
  if (s.remaining == null || weight <= 0) return s.count * s.price;
  return (s.count - 1) * s.price + s.price * (s.remaining / weight);
}
// One spool is a normal shelf. Level 0 or 1 only flags a color that is out.
// Raise the level when you want a spare: 2 flags the last spool, 3 flags two or fewer.
export function countIsLow(count, lowAt) {
  const n = Number(count) || 0;
  const level = Number.isFinite(Number(lowAt)) ? Number(lowAt) : 1;
  if (n <= 0) return true;
  return level > 1 && n < level;
}

export function needsRestock(s, settings) {
  const lowAt = settings && Number.isFinite(Number(settings.lowAt)) ? Number(settings.lowAt) : 1;
  const lowGrams = settings && Number.isFinite(Number(settings.lowGrams)) ? Number(settings.lowGrams) : 200;
  if (countIsLow(s.count, lowAt)) return true;
  return lowGrams > 0 && s.count > 0 && s.remaining != null && s.remaining <= lowGrams;
}

// Fold a second row of the same color into the one being kept. Counts add.
// Grams stay: one open spool, and the rest of the count is full.
export function mergeSpools(keep, other) {
  const count = (keep.count || 0) + (other.count || 0);
  const weight = keep.weight || other.weight || 1000;
  const total = gramsOnHand(keep) + gramsOnHand(other);
  const next = { ...keep, count, weight };
  if (count > 0 && total < count * weight) next.remaining = Math.max(0, Math.min(weight, total - (count - 1) * weight));
  else delete next.remaining;
  if (next.price == null && other.price != null) next.price = other.price;
  const notes = [];
  for (const n of [keep.notes, other.notes]) {
    const t = String(n || '').trim();
    if (t && !notes.includes(t)) notes.push(t);
  }
  const here = String(keep.location || '').trim();
  const there = String(other.location || '').trim();
  next.location = here || there;
  if (here && there && here.toLowerCase() !== there.toLowerCase()) {
    const extra = 'Also in ' + there;
    if (!notes.some((n) => n.toLowerCase().includes(there.toLowerCase()))) notes.push(extra);
  }
  next.notes = notes.join('\n').slice(0, 2000);
  if (keep.isSample && other.isSample) next.isSample = true;
  else delete next.isSample;
  return next;
}

function restockWhy(s, lowGrams) {
  if ((s.count || 0) === 0) return 'out';
  if (lowGrams > 0 && s.remaining != null && s.remaining <= lowGrams) return s.remaining + ' g left';
  return (s.count === 1 ? '1 spool left' : s.count + ' spools left');
}

// Shopping list grouped by brand, with material and how many are left.
export function restockText(spools, settings, shops) {
  const lowGrams = settings && Number.isFinite(Number(settings.lowGrams)) ? Number(settings.lowGrams) : 200;
  const groups = new Map();
  for (const s of spools || []) {
    if (!needsRestock(s, settings)) continue;
    const brand = s.brand || 'Unbranded';
    const key = brand.toLowerCase();
    if (!groups.has(key)) groups.set(key, { brand, items: [] });
    groups.get(key).items.push(s);
  }
  const lines = [...groups.values()]
    .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand))
    .map((g) => {
      const shop = (shops || []).find((sh) => String(sh.brand || '').toLowerCase() === g.brand.toLowerCase());
      const head = [g.brand];
      if (shop && shop.note) head.push(shop.note);
      if (shop && shop.url) head.push(shop.url);
      const body = g.items.map((s) => s.colorName + ', ' + s.material + ' — ' + restockWhy(s, lowGrams));
      return [head.join(' — '), ...body].join('\n');
    });
  return lines.join('\n\n');
}
