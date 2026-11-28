// A paper picture of the shelf. The Insights screen opens this in a new window
// and prints it. Saving from the print dialog is the PDF.
import { gramsOnHand, spoolValue } from './store.js';
import { hueKey, isRainbow, materialTone } from './color.js';
import { brandsInUse, sameBrand } from './filters.js';

const RAINBOW_CONIC = 'conic-gradient(#ff3b30,#ff9f0a 16%,#ffd60a 30%,#30d158 46%,#32ade6 62%,#3b6cff 76%,#bf5af2 88%,#ff3b30)';

function esc(x) {
  return String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function bg(hex) {
  return isRainbow(hex) ? RAINBOW_CONIC : esc(hex || '#888888');
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
function meter(label, bar, n) {
  return '<div class="meter"><span>' + esc(label) + '</span>' + bar + '<b>' + n + '</b></div>';
}
function bar(width, inner, solid) {
  const style = 'width:' + width + '%' + (solid ? ';background:' + solid : '');
  return '<div class="track"><div class="bar" style="' + style + '">' + inner + '</div></div>';
}

export function insightsSheetHtml({ spools, brands, ownerName, brandFilter, when }) {
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
    ? '<div class="strand" role="img" aria-label="Colors laid out by hue, wider where you have more spools">'
      + strand.map((s) => '<i style="background:' + bg(s.hex) + ';flex-grow:' + (Number(s.count) || 1) + '" title="' + esc(s.colorName) + '"></i>').join('')
      + '</div><p class="quiet">Wider means more spools of that color.</p>'
    : '<p class="quiet">Every spool is out, so there is no color bar yet.</p>';

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
    : '<p class="quiet">No spools on hand to split by material.</p>';

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
        .map((s) => '<i style="background:' + bg(s.hex) + ';flex-grow:' + (Number(s.count) || 1) + '"></i>').join('');
      return meter(g.name, bar(g.total ? (g.total / brandMax) * 100 : 0, segs), g.total);
    }).join('')
    : '<p class="quiet">No brands yet.</p>';

  const inventory = groups.map((g) => {
    const rows = g.rows.map((s) => (
      '<tr><td class="dot"><i class="sw" style="background:' + bg(s.hex) + '"></i></td>'
      + '<td>' + esc(s.colorName) + '</td>'
      + '<td class="muted">' + esc(s.material) + '</td>'
      + '<td class="num">' + (Number(s.count) ? esc(plural(Number(s.count), 'spool')) : 'Out') + '</td></tr>'
    )).join('');
    const on = g.total === 1 ? '1 spool on hand' : g.total + ' spools on hand';
    return '<section class="brand"><h3>' + esc(g.name) + '</h3><p class="quiet">' + esc(plural(g.rows.length, 'color')) + ' · ' + esc(on) + '</p><table>' + rows + '</table></section>';
  }).join('');

  const worth = priced.length
    ? '<div><b>' + esc(money(value)) + '</b><span>' + (priced.length < onHand.length ? 'in priced colors' : 'of filament') + '</span></div>'
    : '';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>'
    + '@page{margin:14mm}*{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}'
    + 'body{margin:0;background:#f4f0e8;color:#1c1e26;font-family:"Iowan Old Style",Georgia,serif}'
    + '.page{max-width:880px;margin:0 auto;padding:28px 28px 48px}'
    + 'header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;padding-bottom:16px;border-bottom:1px solid #ddd4c6}'
    + 'h1{font:700 40px/1 "Iowan Old Style",Georgia,serif;letter-spacing:-.03em;margin:0}'
    + '.meta{margin:8px 0 0;font:14px/1.4 system-ui,sans-serif;color:#4c5160}'
    + '.nums{display:flex;gap:22px;font-family:system-ui,sans-serif;flex:none}'
    + '.nums b{display:block;font:700 28px/1 "Iowan Old Style",Georgia,serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums}'
    + '.nums span{display:block;margin-top:3px;font-size:12px;color:#4c5160}'
    + 'h2{font:700 22px/1.1 "Iowan Old Style",Georgia,serif;margin:28px 0 10px;letter-spacing:-.02em}'
    + 'h3{font:650 18px/1.2 "Iowan Old Style",Georgia,serif;margin:20px 0 0}'
    + '.quiet{margin:4px 0 8px;color:#4c5160;font:13px/1.4 system-ui,sans-serif}'
    + '.strand{display:flex;height:36px;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(28,30,38,.18)}'
    + '.strand i{flex-basis:0;min-width:3px}'
    + '.split{display:grid;grid-template-columns:1fr 1fr;gap:28px}'
    + '.meter{display:grid;grid-template-columns:minmax(0,11.5rem) 1fr 2rem;gap:8px;align-items:center;margin:7px 0;font:13px/1.25 system-ui,sans-serif}'
    + '.meter>span{overflow-wrap:anywhere}'
    + '.track{height:16px;background:#efeae1;border-radius:999px;overflow:hidden}'
    + '.bar{height:100%;display:flex;border-radius:999px;overflow:hidden;min-width:0}'
    + '.bar i{flex-basis:0;min-width:2px}'
    + '.meter b{text-align:right;font-variant-numeric:tabular-nums}'
    + 'table{width:100%;border-collapse:collapse;font:14px/1.3 system-ui,sans-serif}'
    + 'td{padding:7px 10px 7px 0;border-bottom:1px solid #e6dfd3;vertical-align:middle}'
    + 'td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#4c5160}'
    + 'td.muted{color:#4c5160}'
    + '.sw{width:16px;height:16px;border-radius:50%;display:block;box-shadow:inset 0 0 0 1px rgba(28,30,38,.25)}'
    + '@media (max-width:640px){header{flex-direction:column;align-items:flex-start}.split{grid-template-columns:1fr}.nums{flex-wrap:wrap}}'
    + '@media print{body{background:#fff}.page{max-width:none;padding:0}}'
    + '</style></head><body><div class="page"><header><div><h1>' + esc(title) + '</h1><p class="meta">' + esc(date) + ' · Filament Shelf<br>' + esc(scope) + '</p></div>'
    + '<div class="nums"><div><b>' + colors + '</b><span>' + (colors === 1 ? 'color' : 'colors') + '</span></div>'
    + '<div><b>' + spoolCount + '</b><span>' + (spoolCount === 1 ? 'spool' : 'spools') + '</span></div>'
    + '<div><b>' + esc(kg(grams)) + '</b><span>on hand</span></div>' + worth + '</div></header>'
    + '<h2>Colors</h2>' + strandHtml
    + '<div class="split"><section><h2>Materials</h2>' + matHtml + '</section><section><h2>Brands</h2>' + brandHtml + '</section></div>'
    + '<h2>On the shelf</h2>' + (inventory || '<p class="quiet">Nothing is on this shelf yet.</p>')
    + '</div><script>addEventListener("load",function(){print()})<\/script></body></html>';
}
