// A paper picture of the shelf. The Insights screen opens this in a new window
// and prints it. Saving from the print dialog is the PDF.
import { gramsOnHand, spoolValue } from './store.js';
import { hueKey, isRainbow, materialTone } from './color.js';
import { brandsInUse, sameBrand } from './filters.js';

// Solid bands, not a conic gradient. A gradient on this paper prints as black.
export const RAINBOW_BANDS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#30d158', '#32ade6', '#3b6cff', '#bf5af2'];

function esc(x) {
  return String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function bands() {
  return RAINBOW_BANDS.map((h) => '<b data-bg="' + h + '"></b>').join('');
}
function chip(hex, grow, title) {
  const g = grow ? ' data-grow="' + grow + '"' : '';
  const t = title ? ' title="' + esc(title) + '"' : '';
  if (isRainbow(hex)) return '<i class="p-rain"' + g + t + '>' + bands() + '</i>';
  return '<i data-bg="' + esc(hex || '#888888') + '"' + g + t + '></i>';
}
function kg(g) {
  return (g / 1000).toFixed(g >= 100000 ? 0 : 1) + ' kg';
}
function money(n) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n); }
  catch (e) { return '$' + Number(n).toFixed(2); }
}
function plural(n, w) {
  return n + ' ' + w + (n === 1 ? '' : 's');
}

function meter(label, barHtml, n) {
  return '<div class="p-meter"><span>' + esc(label) + '</span>' + barHtml + '<b>' + n + '</b></div>';
}
function bar(width, inner, solid) {
  const fill = solid ? ' data-bg="' + esc(solid) + '"' : '';
  return '<div class="p-track"><div class="p-bar" data-w="' + width + '"' + fill + '>' + inner + '</div></div>';
}

export function insightsSheetHtml({ spools, brands, ownerName, brandFilter, when, cssHref }) {
  const raw = Array.isArray(spools) ? spools : [];
  const filter = (Array.isArray(brandFilter) ? brandFilter : []).map((b) => String(b || '').trim()).filter(Boolean);
  const list = filter.length ? raw.filter((s) => filter.some((b) => sameBrand(s.brand, b))) : raw;
  const colors = new Set(list.map((s) => String(s.hex || '').toUpperCase())).size;
  const spoolCount = list.reduce((a, s) => a + (Number(s.count) || 0), 0);
  const grams = list.reduce((a, s) => a + gramsOnHand(s), 0);
  const onHand = list.filter((s) => (Number(s.count) || 0) > 0);
  const priced = onHand.filter((s) => s.price != null);
  const value = priced.reduce((a, s) => a + spoolValue(s), 0);
  const who = String(ownerName || '').trim();
  const title = who ? who + "'s shelf" : 'Your shelf';
  const date = (when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date())
    .toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const scope = filter.length ? 'Only ' + filter.join(', ') + '.' : 'Every brand on this shelf.';

  const strand = [...list].filter((s) => (Number(s.count) || 0) > 0).sort((a, b) => hueKey(a.hex) - hueKey(b.hex) || String(a.colorName).localeCompare(String(b.colorName)));
  const strandHtml = strand.length
    ? '<div class="p-strand" role="img" aria-label="Colors laid out by hue, wider where you have more spools">'
      + strand.map((s) => chip(s.hex, Number(s.count) || 1, s.colorName)).join('')
      + '</div><p class="p-quiet">Wider means more spools of that color.</p>'
    : '<p class="p-quiet">Every spool is out, so there is no color bar yet.</p>';

  const matMap = new Map();
  for (const s of list) {
    const name = String(s.material || '').trim() || 'Other';
    const n = Number(s.count) || 0;
    const cur = matMap.get(name);
    if (cur) cur.n += n;
    else matMap.set(name, { name, n, fill: materialTone(name).fill });
  }
  const mats = [...matMap.values()].filter((m) => m.n > 0).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const matMax = Math.max(1, ...mats.map((m) => m.n));
  const matHtml = mats.length
    ? mats.map((m) => meter(m.name, bar((m.n / matMax) * 100, '', m.fill), m.n)).join('')
    : '<p class="p-quiet">No spools on hand to split by material.</p>';

  const names = brandsInUse(brands, list);
  const groups = names.map((name) => {
    const rows = list.filter((s) => sameBrand(s.brand, name))
      .sort((a, b) => hueKey(a.hex) - hueKey(b.hex) || String(a.colorName).localeCompare(String(b.colorName)));
    const total = rows.reduce((a, s) => a + (Number(s.count) || 0), 0);
    return { name, rows, total };
  });
  const brandMax = Math.max(1, ...groups.map((g) => g.total));
  const brandHtml = groups.length
    ? groups.map((g) => {
      const segs = g.rows.filter((s) => (Number(s.count) || 0) > 0)
        .map((s) => chip(s.hex, Number(s.count) || 1)).join('');
      return meter(g.name, bar(g.total ? (g.total / brandMax) * 100 : 0, segs), g.total);
    }).join('')
    : '<p class="p-quiet">No brands yet.</p>';

  const inventory = groups.map((g) => {
    const rows = g.rows.map((s) => (
      '<tr><td class="dot">' + (isRainbow(s.hex) ? '<i class="p-sw p-rain">' + bands() + '</i>' : '<i class="p-sw" data-bg="' + esc(s.hex || '#888888') + '"></i>') + '</td>'
      + '<td>' + esc(s.colorName) + '</td>'
      + '<td class="p-muted">' + esc(s.material) + '</td>'
      + '<td class="p-num">' + (Number(s.count) ? esc(plural(Number(s.count), 'spool')) : 'Out') + '</td></tr>'
    )).join('');
    const on = g.total === 1 ? '1 spool on hand' : g.total + ' spools on hand';
    return '<section class="p-brand"><h3>' + esc(g.name) + '</h3><p class="p-quiet">' + esc(plural(g.rows.length, 'color')) + ' · ' + esc(on) + '</p><table>' + rows + '</table></section>';
  }).join('');

  const worth = priced.length
    ? '<div><b>' + esc(money(value)) + '</b><span>' + (priced.length < onHand.length ? 'in priced colors' : 'of filament') + '</span></div>'
    : '';

  const href = String(cssHref || '');
  const link = href ? '<link rel="stylesheet" href="' + esc(href) + '">' : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' + link + '</head><body><div class="p-page"><header><div><h1>' + esc(title) + '</h1><p class="p-meta">' + esc(date) + ' · Filament Shelf<br>' + esc(scope) + '</p></div>'
    + '<div class="p-nums"><div><b>' + colors + '</b><span>' + (colors === 1 ? 'color' : 'colors') + '</span></div>'
    + '<div><b>' + spoolCount + '</b><span>' + (spoolCount === 1 ? 'spool' : 'spools') + '</span></div>'
    + '<div><b>' + esc(kg(grams)) + '</b><span>on hand</span></div>' + worth + '</div></header>'
    + '<h2>Colors</h2>' + strandHtml
    + '<div class="p-split"><section><h2>Materials</h2>' + matHtml + '</section><section><h2>Brands</h2>' + brandHtml + '</section></div>'
    + '<h2>On the shelf</h2>' + (inventory || '<p class="p-quiet">Nothing is on this shelf yet.</p>')
    + '</div></body></html>';
}
