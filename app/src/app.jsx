import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell } from 'recharts';
import { loadInitial, saveLocal, publish, waitForClaude, getDownloads, uid, parseBackup, toCsv, spoolKey, server, signOut, bootStatus, fetchLatest, adoptRev, dropPending, gramsOnHand, spoolValue, needsRestock, changePassword, signOutOthers, mergeSpools, restockText, withShop } from './store.js';
import { hexToHsv, hsvToHex, hexToRgb, hueKey, luminance, validHex, clamp, isRainbow, RAINBOW_HEX, hexFromName, hexMatchesName, spoolFinish, materialTone } from './color.js';
import { activeNames, brandsInUse, sameBrand } from './filters.js';

const MATERIALS = ['PLA', 'PLA+', 'Matte PLA', 'Silk PLA', 'PLA-CF', 'PETG', 'PETG-CF', 'TPU', 'ABS', 'ASA', 'Nylon', 'PC', 'PVB'];
const OTHER = { light: '#8b90a0', dark: '#6f7586' };
const PRESETS = [
  ['White', '#F4F3EE'], ['Light Gray', '#B9BDC4'], ['Gray', '#74787F'], ['Black', '#1E1F24'],
  ['Red', '#D63A2F'], ['Orange', '#F27A2E'], ['Yellow', '#F6C416'], ['Lime', '#9BCB3C'],
  ['Green', '#0BA84A'], ['Mint', '#9FDCC2'], ['Teal', '#1A9E9A'], ['Sky Blue', '#3A9FE0'],
  ['Blue', '#2456C9'], ['Navy', '#1E2A5A'], ['Purple', '#7A45C4'], ['Lavender', '#A48BD8'],
  ['Magenta', '#D43F9A'], ['Pink', '#F5A3C0'], ['Brown', '#7B4B2A'], ['Beige', '#DCC9A6'],
  ['Gold', '#C9A227'], ['Copper', '#B5663A'], ['Silver', '#C7CCD1'], ['Bone', '#E9E1CF'],
  ['Rainbow', RAINBOW_HEX],
];

const SUGGESTED_BRANDS = ['Elegoo', 'eSUN', 'Sunlu', 'Hatchbox', 'Creality', 'Anycubic', 'Amolen', 'Eryone', 'Inland', 'Jayo', 'Kingroon', 'Tinmorry', 'Atomic Filament', 'Protopasta', 'MatterHackers', 'ColorFabb', 'Fillamentum', 'Paramount 3D', 'Duramic', 'Geeetech'];
const money = (n) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n); } catch (e) { return '$' + n.toFixed(2); } };
const kg = (g) => (g / 1000).toFixed(g >= 100000 ? 0 : 1) + ' kg';
function nearestName(hex) {
  if (isRainbow(hex)) return 'Rainbow';
  const [r, g, b] = hexToRgb(hex); let best = PRESETS[0][0], bd = Infinity;
  for (const [n, h] of PRESETS) {
    if (isRainbow(h)) continue;
    const [r2, g2, b2] = hexToRgb(h), rm = (r + r2) / 2;
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/* ---------- small helpers ---------- */
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const ss = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
function useDark() {
  const [dark, setDark] = useState(() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } });
  useEffect(() => {
    let mq; try { mq = matchMedia('(prefers-color-scheme: dark)'); } catch (e) { return; }
    const f = (e) => setDark(e.matches);
    mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f));
  }, []);
  return dark;
}

const I = {
  plus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  minus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  more: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>,
  shelf: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="8" r="3.5" /><circle cx="16.5" cy="8" r="3.5" /><path d="M3 14.5h18M3 20h18" /></svg>,
  chart: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6" /></svg>,
  warn: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.4v.2" /></svg>,
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  chev: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>,
  pin: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1113 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></svg>,
  dup: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></svg>,
  drop: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5l4 4M4 20l1-4 9.5-9.5 3 3L8 19l-4 1z" /></svg>,
};

/* ---------- the spool ---------- */
const FLECKS = [
  [0.22, 24, 2.4], [0.48, 78, 3.4], [0.7, 132, 2.2], [0.36, 188, 4.1],
  [0.62, 236, 2.6], [0.28, 292, 3.2], [0.74, 334, 2.3], [0.52, 40, 2.1],
];
// Saturated and evenly spaced. A diagonal blend on the ring collapses into two muddy tones.
const RAINBOW_COLORS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#30d158', '#32ade6', '#3b6cff', '#bf5af2'];
const RAINBOW_CONIC = 'conic-gradient(#ff3b30,#ff9f0a 16%,#ffd60a 30%,#30d158 46%,#32ade6 62%,#3b6cff 76%,#bf5af2 88%,#ff3b30)';

function rainbowBands(R) {
  const inner = 20.2;
  const n = RAINBOW_COLORS.length;
  const span = R - inner;
  if (span < 2.5) return <circle cx="50" cy="50" r={Math.max(R, 8)} fill={RAINBOW_COLORS[0]} />;
  const w = span / n;
  return RAINBOW_COLORS.map((color, i) => (
    <circle key={color} cx="50" cy="50" r={R - w * i - w / 2} fill="none" stroke={color} strokeWidth={w + 0.5} />
  ));
}

function rainbowWedges(cx, cy, r) {
  const n = RAINBOW_COLORS.length;
  return RAINBOW_COLORS.map((color, i) => {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    return <path key={color} d={'M ' + cx + ' ' + cy + ' L ' + x0 + ' ' + y0 + ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + y1 + ' Z'} fill={color} />;
  });
}

function flecks(table, R, fill, prefix) {
  return table.map(([t, deg, rad], i) => {
    const rr = 24 + Math.max(0, R - 28) * t;
    if (rr + rad > R - 0.4) return null;
    const a = ((deg - 90) * Math.PI) / 180;
    return <circle key={prefix + i} cx={50 + rr * Math.cos(a)} cy={50 + rr * Math.sin(a)} r={rad} fill={fill(i)} />;
  });
}

// Smaller than speckle, and pointed, so a glitter roll does not read as matte dots.
const GLINTS = [
  [0.2, 18, 1], [0.55, 42, 0], [0.78, 64, 0], [0.33, 88, 1],
  [0.62, 112, 0], [0.25, 136, 0], [0.84, 158, 1], [0.48, 182, 0],
  [0.7, 206, 1], [0.22, 230, 0], [0.58, 254, 0], [0.36, 278, 1],
  [0.8, 302, 0], [0.5, 326, 1], [0.28, 350, 0], [0.66, 8, 0],
  [0.42, 200, 1],
];
const GLINT_HOT = ['#ffffff', '#fff4c8', '#e7f8ff'];

function starPath(x, y, r) {
  const inner = r * 0.32;
  let d = '';
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 ? inner : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    d += (i ? ' L ' : 'M ') + (x + rad * Math.cos(a)).toFixed(2) + ' ' + (y + rad * Math.sin(a)).toFixed(2);
  }
  return d + ' Z';
}

function glitterMarks(R, light) {
  return GLINTS.map(([t, deg, star], i) => {
    const rr = 23 + Math.max(0, R - 26) * t;
    const arm = star ? 2.35 + (i % 3) * 0.55 : 0;
    const reach = star ? arm : 1.5;
    if (rr + reach > R - 0.45 || rr - reach < 21) return null;
    const a = ((deg - 90) * Math.PI) / 180;
    const x = 50 + rr * Math.cos(a);
    const y = 50 + rr * Math.sin(a);
    const hot = GLINT_HOT[i % 3];
    if (star) {
      return (
        <g key={'g' + i}>
          <circle cx={x} cy={y} r={arm * 0.42} fill="#fff" opacity="0.55" />
          <path d={starPath(x, y, arm)} fill={hot} stroke="rgba(24,16,32,.45)" strokeWidth="0.32" />
        </g>
      );
    }
    const rot = (deg * 1.7 + i * 23) % 180;
    const rx = 1.25 + (i % 3) * 0.22;
    const ry = 0.52;
    const body = light
      ? (i % 2 ? 'rgba(120,48,78,.72)' : 'rgba(255,255,255,.96)')
      : (i % 2 ? 'rgba(255,228,160,.96)' : 'rgba(255,255,255,.96)');
    return (
      <g key={'g' + i} transform={'rotate(' + rot + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ')'}>
        <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={body} stroke="rgba(24,16,32,.28)" strokeWidth="0.18" />
        <ellipse cx={x - rx * 0.22} cy={y - ry * 0.15} rx={rx * 0.34} ry={ry * 0.55} fill="#fff" />
      </g>
    );
  });
}

function Spool({ hex, count = 1, material = '', colorName = '', size = 96, remaining = null, weight = 1000 }) {
  const bare = count <= 0 || (count === 1 && remaining === 0);
  const ratio = bare ? 0 : (remaining != null && count === 1 && weight > 0 ? Math.max(0.08, Math.min(1, remaining / weight)) : Math.min(Math.max(count, 0), 5) / 5);
  const out = bare;
  const fill = out ? 0 : 0.36 + 0.64 * ratio;
  const R = 19 + fill * 26;
  const rain = isRainbow(hex);
  const finish = spoolFinish(material, colorName);
  const dark = !rain && luminance(hex) < 0.18;
  const pale = !rain && luminance(hex) > 0.78;
  const lines = [];
  for (let r = 22.4; r < R - 1; r += 3.1) lines.push(r);
  const sheen = rain ? (finish.silk ? 0.28 : 0.1) : finish.silk ? 0.85 : /matte/i.test(material + ' ' + colorName) ? 0.16 : 0.32;
  const wound = hex;
  const light = pale || (!rain && luminance(hex) > 0.55);
  return (
    <svg className={'spool' + (out ? ' is-out' : '') + (pale ? ' is-pale' : '')} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <circle cx="50" cy="50" r="48" className="sp-flange" />
      {out ? (
        rain ? <g className="sp-wound">{rainbowBands(34)}</g> : <circle cx="50" cy="50" r="34" className="sp-empty" />
      ) : (
        <g>
          {rain ? <g className="sp-wound">{rainbowBands(R)}</g> : <circle cx="50" cy="50" r={R} fill={wound} className="sp-wound" />}
          {!rain && lines.map((r) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={dark ? 'rgba(255,255,255,.11)' : 'rgba(0,0,0,.09)'} strokeWidth="0.7" />)}
          {finish.speckle && flecks(FLECKS, R, (i) => (light ? (i % 2 ? 'rgba(48,36,24,.62)' : 'rgba(90,70,50,.4)') : (i % 2 ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,.42)')), 's')}
          <circle cx="50" cy="50" r={R} fill="url(#sp-sheen)" opacity={sheen} className="sp-wound" />
          {finish.glitter && glitterMarks(R, !rain && luminance(hex) > 0.42)}
          <circle cx="50" cy="50" r={R} fill="none" className="sp-edge" />
        </g>
      )}
      <circle cx="50" cy="50" r="19" className="sp-hub" />
      {out && !rain && <circle cx="50" cy="50" r="19" fill="none" stroke={wound} strokeWidth="3.5" />}
      {out && <circle cx="50" cy="50" r="21" fill="none" className="sp-edge" />}
      {[0, 120, 240].map((a) => {
        const t = ((a - 90) * Math.PI) / 180;
        return <circle key={a} cx={50 + 11.5 * Math.cos(t)} cy={50 + 11.5 * Math.sin(t)} r="2.9" className="sp-hole" />;
      })}
      <circle cx="50" cy="50" r="4.6" className="sp-hole" />
    </svg>
  );
}

/* ---------- sheets ---------- */
const sheetStack = [];
let lockCount = 0;
function Sheet({ title, onClose, children, tall, level = 0 }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const id = {}; sheetStack.push(id);
    const prev = document.activeElement;
    lockCount++; document.documentElement.classList.add('lock');
    const vv = window.visualViewport;
    // Keep the sheet inside the visible area when the iOS keyboard is up.
    const fit = () => { if (vv) { const r = document.documentElement.style; r.setProperty('--vvh', vv.height + 'px'); r.setProperty('--vvt', vv.offsetTop + 'px'); } };
    fit();
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    try { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true }); } catch (e) {}
    const key = (e) => {
      if (sheetStack[sheetStack.length - 1] !== id) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const a = document.activeElement, first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
        else if (!ref.current.contains(a)) { e.preventDefault(); first.focus(); }
      }
    };
    const focusIn = (e) => {
      const t = e.target;
      if (t && ref.current && ref.current.contains(t) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {} }, 320);
    };
    window.addEventListener('keydown', key);
    document.addEventListener('focusin', focusIn);
    return () => {
      window.removeEventListener('keydown', key); document.removeEventListener('focusin', focusIn);
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      const i = sheetStack.indexOf(id); if (i >= 0) sheetStack.splice(i, 1);
      if (--lockCount <= 0) { lockCount = 0; document.documentElement.classList.remove('lock'); }
      // Wait a beat so the page behind is no longer inert, then hand focus back.
      setTimeout(() => { if (prev && prev.isConnected && typeof prev.focus === 'function' && !sheetStack.length) { try { prev.focus({ preventScroll: true }); } catch (e) {} } }, 40);
    };
  }, []);
  // Swipe the header down to dismiss on phones.
  const onDown = (e) => {
    if (e.target.closest('button') || window.matchMedia('(min-width:700px)').matches) return;
    drag.current = { y: e.clientY, t: Date.now(), dy: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {}
    ref.current.style.transition = 'none';
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transform = 'translateY(' + d.dy + 'px)';
  };
  const onUp = () => {
    const d = drag.current; if (!d) return; drag.current = null;
    const el = ref.current; if (!el) return;
    el.style.transition = 'transform .22s cubic-bezier(.2,.9,.25,1)';
    const v = d.dy / Math.max(1, Date.now() - d.t);
    if (d.dy > 120 || (v > 0.6 && d.dy > 40)) { el.style.transform = 'translateY(105%)'; setTimeout(() => closeRef.current(), 200); }
    else el.style.transform = '';
  };
  return (
    <div className="sheet-wrap" style={{ zIndex: 50 + level * 10 }}>
      <div className="scrim" onClick={onClose} />
      <section ref={ref} tabIndex={-1} className={'sheet' + (tall ? ' tall' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="grab" aria-hidden="true" />
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">{I.close}</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

function Confirm({ c, onClose }) {
  return (
    <Sheet title={c.title} onClose={onClose} level={2}>
      <p className="lead">{c.body}</p>
      <div className="row-btns">
        <button className="btn ghost" onClick={onClose}>Keep it</button>
        <button className={'btn ' + (c.danger ? 'danger' : 'primary')} onClick={() => { c.onConfirm(); onClose(); }}>{c.action}</button>
      </div>
    </Sheet>
  );
}

/* ---------- color picker ---------- */
function useDrag(onMove) {
  const ref = useRef(null);
  const handler = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    onMove(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
  };
  return {
    ref,
    onPointerDown: (e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {} handler(e); },
    onPointerMove: (e) => { if (e.buttons || e.pointerType === 'touch') handler(e); },
  };
}

function ColorPicker({ hex, onChange, onPreset, onGuess }) {
  const [hsv, setHsv] = useState(() => hexToHsv(hex));
  const [text, setText] = useState(hex);
  const [custom, setCustom] = useState(() => !PRESETS.some((p) => p[1] === hex));
  const last = useRef(hex);
  useEffect(() => {
    if (hex !== last.current) { last.current = hex; setHsv(hexToHsv(hex)); setText(hex); }
  }, [hex]);
  const push = (h, preset) => { last.current = h; setText(h); onChange(h); if (!preset && onGuess) onGuess(nearestName(h)); };
  const setFromHsv = (n) => { setHsv(n); push(hsvToHex(n.h, n.s, n.v)); };
  const sv = useDrag((x, y) => setFromHsv({ h: hsv.h, s: x, v: 1 - y }));
  const hue = useDrag((x) => setFromHsv({ h: Math.min(359.9, x * 360), s: hsv.s || 0.8, v: hsv.v || 0.9 }));
  const key = (e, kind) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return; e.preventDefault();
    if (kind === 'hue') setFromHsv({ ...hsv, h: clamp(hsv.h + d[0] * 4 + d[1] * 4, 0, 359.9) });
    else setFromHsv({ ...hsv, s: clamp(hsv.s + d[0] * 0.03, 0, 1), v: clamp(hsv.v + d[1] * 0.03, 0, 1) });
  };
  return (
    <div className="picker">
      <div className="presets" role="listbox" aria-label="Common filament colors">
        {PRESETS.map(([name, h]) => (
          <button type="button" key={h} role="option" aria-selected={hex === h} title={name} aria-label={name}
            className={'preset' + (isRainbow(h) ? ' swatch-rainbow' : '') + (hex.toUpperCase() === h ? ' on' : '')} style={isRainbow(h) ? undefined : { '--c': h }}
            onClick={() => { setHsv(isRainbow(h) ? { h: 0, s: 1, v: 1 } : hexToHsv(h)); push(h, true); onPreset && onPreset(name); }}>
            {hex.toUpperCase() === h && <span className={!isRainbow(h) && luminance(h) > 0.5 ? 'tick dk' : 'tick'}>{I.check}</span>}
          </button>
        ))}
      </div>
      <div className="picker-links">
        <button type="button" className="link-btn" onClick={() => setCustom(!custom)} aria-expanded={custom}>
          {custom ? 'Hide the mixer' : 'Mix an exact shade'}
        </button>
        {typeof window !== 'undefined' && window.EyeDropper && (
          <button type="button" className="link-btn" onClick={async () => {
            try { const r = await new window.EyeDropper().open(); const u = String(r.sRGBHex).toUpperCase(); if (validHex(u)) { setHsv(hexToHsv(u)); push(u); } } catch (e) {}
          }}>Pick from screen</button>
        )}
      </div>
      {custom && (
        <div className="mixer">
          <div className="sv" {...sv} tabIndex={0} role="slider" aria-label="Saturation and brightness"
            aria-valuetext={Math.round(hsv.s * 100) + '% saturation, ' + Math.round(hsv.v * 100) + '% brightness'}
            onKeyDown={(e) => key(e, 'sv')} style={{ '--hue': hsvToHex(hsv.h, 1, 1) }}>
            <i className={isRainbow(hex) ? 'swatch-rainbow' : undefined} style={{ left: hsv.s * 100 + '%', top: (1 - hsv.v) * 100 + '%', background: isRainbow(hex) ? undefined : hex }} />
          </div>
          <div className="hue" {...hue} tabIndex={0} role="slider" aria-label="Hue" aria-valuemin={0} aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)} onKeyDown={(e) => key(e, 'hue')}>
            <i style={{ left: (hsv.h / 360) * 100 + '%', background: hsvToHex(hsv.h, 1, 1) }} />
          </div>
        </div>
      )}
      <label className="hexfield">
        <span className={'hexdot' + (isRainbow(hex) ? ' swatch-rainbow' : '')} style={isRainbow(hex) ? undefined : { background: hex }} />
        <span className="sr">Hex color</span>
        <input value={text} spellCheck={false} autoCapitalize="characters" maxLength={7} inputMode="text"
          onChange={(e) => {
            let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v;
            setText(v.toUpperCase());
            if (validHex(v)) { const u = v.toUpperCase(); last.current = u; setHsv(hexToHsv(u)); onChange(u); if (onGuess) onGuess(nearestName(u)); }
          }}
          onBlur={() => setText(hex)} />
      </label>
    </div>
  );
}

/* ---------- catalog (Open Filament Database, MIT) ---------- */
let CAT = null;
function getCatalog() {
  if (CAT) return CAT;
  const items = [], counts = {};
  let notice = '', source = '';
  try {
    const d = JSON.parse(document.getElementById('filament-catalog').textContent);
    notice = d.notice || ''; source = d.source || '';
    d.brands.forEach((b) => b.l.forEach((l) => l.c.forEach(([c, h]) => {
      items.push({ c, h: '#' + h, b: b.b, l: l.f, m: l.m, k: (c + ' ' + b.b + ' ' + l.f + ' ' + l.m).toLowerCase() });
      counts[b.b] = (counts[b.b] || 0) + 1;
    })));
  } catch (e) {}
  CAT = { items, counts, notice, source };
  return CAT;
}
function pickMaterial(line, m) {
  if (m !== 'PLA') return m;
  if (/silk/i.test(line)) return 'Silk PLA';
  if (/matte/i.test(line)) return 'Matte PLA';
  if (/cf|carbon/i.test(line)) return 'PLA-CF';
  if (/\+|plus/i.test(line)) return 'PLA+';
  return 'PLA';
}

function CatalogSheet({ myBrands, onPick, onClose }) {
  const cat = useMemo(getCatalog, []);
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState(null);
  const [lim, setLim] = useState(60);
  const mine = useMemo(() => new Set(myBrands.map((b) => b.toLowerCase())), [myBrands]);
  const brandList = useMemo(() => Object.keys(cat.counts).sort((a, b) => (mine.has(a.toLowerCase()) ? 0 : 1) - (mine.has(b.toLowerCase()) ? 0 : 1) || a.localeCompare(b)), [cat, mine]);
  const results = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length && !brand) return null;
    const score = (i) => {
      const cn = i.c.toLowerCase();
      const hits = toks.filter((t) => cn.includes(t)).length;
      return (mine.has(i.b.toLowerCase()) ? 0 : 100) + (toks.length - hits) * 10 + (toks.some((t) => cn.startsWith(t)) ? 0 : 1);
    };
    return cat.items.filter((i) => (!brand || i.b === brand) && toks.every((t) => i.k.includes(t)))
      .map((i) => [score(i), i]).sort((a, b) => a[0] - b[0] || a[1].b.localeCompare(b[1].b) || a[1].c.localeCompare(b[1].c)).map((x) => x[1]);
  }, [cat, q, brand, mine]);
  useEffect(() => { setLim(60); }, [q, brand]);
  return createPortal(
    <Sheet title="Find in the catalog" onClose={onClose} tall level={1}>
      <label className="search cat-search">
        {I.search}<span className="sr">Search the catalog</span>
        <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “overture sky” or “elegoo red”" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter' && results && results[0]) { e.preventDefault(); onPick(results[0]); } }} />
        {q && <button type="button" className="icon-btn tiny" onClick={() => setQ('')} aria-label="Clear search">{I.close}</button>}
      </label>
      <div className="chips cat-chips" aria-label="Brands">
        {brandList.map((b) => <button type="button" key={b} className={'chip' + (brand === b ? ' on' : '')} aria-pressed={brand === b} onClick={() => setBrand(brand === b ? null : b)}>{b}</button>)}
      </div>
      {results === null ? (
        <p className="lead cat-hint">Search by color, brand or product line, or pick a brand to browse its colors. Tap one to fill in the name, color, brand and material.</p>
      ) : results.length === 0 ? (
        <div className="empty slim">
          <h2>No match</h2>
          <p>Try fewer words. The catalog doesn’t cover every brand or line, so you can always add it by hand.</p>
        </div>
      ) : (
        <>
          <p className="count-line">{results.length === 1 ? '1 color' : results.length + ' colors'}{results.length > lim ? ', showing the first ' + lim : ''}</p>
          <ul className="cat-list">
            {results.slice(0, lim).map((i, n) => (
              <li key={i.b + i.l + i.c + n}>
                <button type="button" className="cat-row" onClick={() => onPick(i)}>
                  <span className="cat-sw" style={{ background: i.h }} />
                  <span className="cat-txt"><strong>{i.c}</strong><small>{i.b} · {i.l}</small></span>
                  <span className="tag">{pickMaterial(i.l, i.m)}</span>
                </button>
              </li>
            ))}
          </ul>
          {results.length > lim && <button type="button" className="btn ghost full" onClick={() => setLim(lim + 100)}>Show more</button>}
        </>
      )}
      <details className="lic">
        <summary>Where this comes from</summary>
        <p className="fine">Colors come from the <a href={cat.source || 'https://github.com/OpenFilamentCollective/open-filament-database'} target="_blank" rel="noopener noreferrer">Open Filament Database</a>, a community project. Hex values are the database’s, so your spool may differ a little.</p>
        <p className="fine lic-text">{cat.notice}</p>
      </details>
    </Sheet>,
    document.body
  );
}

/* ---------- add / edit ---------- */
function labelText(s) {
  const left = s.remaining == null ? '' : s.remaining + ' g left';
  return [s.colorName, [s.brand, s.material].filter(Boolean).join(' · '), s.location || '', isRainbow(s.hex) ? '' : s.hex, left].filter(Boolean).join('\n');
}
function printLabel(s) {
  const w = window.open('', '_blank', 'noopener,width=480,height=360');
  if (!w) return false;
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const left = s.remaining == null ? '' : '<p>' + e(s.remaining) + ' g left</p>';
  const where = s.location ? '<p>' + e(s.location) + '</p>' : '';
  const dot = isRainbow(s.hex)
    ? 'background:' + RAINBOW_CONIC
    : 'background:' + e(s.hex);
  w.document.write('<!DOCTYPE html><html><head><title>' + e(s.colorName) + '</title><style>body{font-family:"Iowan Old Style",Georgia,serif;margin:32px;color:#1c1e26} .dot{width:84px;height:84px;border-radius:50%;border:10px solid #eceff4} h1{font-size:28px;margin:12px 0 4px} p{margin:2px 0;color:#4c5160;font-family:system-ui,sans-serif}</style></head><body><div class="dot" style="' + dot + '"></div><h1>' + e(s.colorName) + '</h1><p>' + e(s.brand) + ' · ' + e(s.material) + '</p>' + where + left + '<script>addEventListener("load",function(){print()})<\/script></body></html>');
  w.document.close();
  return true;
}

function SpoolForm({ spool, seed, brands, locations, others = [], onSave, onDelete, onDuplicate, onCombine, onAddBrand, toast }) {
  const isNew = !spool;
  const base = spool || seed;
  const [f, setF] = useState(() => base
    ? { ...base, price: base.price == null ? '' : String(base.price), weight: String(base.weight || 1000), location: base.location || '', remaining: base.remaining == null ? '' : String(base.remaining) }
    : { brand: ss.get('fs-last-brand', brands[0] || ''), material: ss.get('fs-last-mat', 'PLA'), colorName: '', hex: '#3A9FE0', count: 1, notes: '', location: '', price: '', weight: '1000', remaining: '' });
  const [customMat, setCustomMat] = useState(() => !MATERIALS.includes(f.material));
  const [newBrand, setNewBrand] = useState(null);
  const [more, setMore] = useState(() => !!(f.location || f.price !== '' || f.weight !== '1000' || f.remaining !== ''));
  const autoName = useRef(isNew && !seed);
  const [catOpen, setCatOpen] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const addBrand = () => {
    const b = (newBrand || '').trim(); if (!b) return;
    const existing = brands.find((x) => x.toLowerCase() === b.toLowerCase());
    if (!existing) onAddBrand(b);
    set('brand', existing || b); setNewBrand(null);
  };
  const pick = (i) => {
    const existing = brands.find((x) => x.toLowerCase() === i.b.toLowerCase());
    if (!existing) onAddBrand(i.b);
    const mat = pickMaterial(i.l, i.m);
    const line = i.l && ![mat, i.m].some((x) => x.toLowerCase() === i.l.toLowerCase()) ? i.l : '';
    autoName.current = false;
    setCustomMat(!MATERIALS.includes(mat));
    setF((p) => ({ ...p, colorName: i.c, hex: i.h, brand: existing || i.b, material: mat, notes: p.notes || line }));
    setCatOpen(false);
  };
  const ok = f.colorName.trim() && f.brand && f.material.trim() && validHex(f.hex);
  const sameName = (x) => x.id !== f.id && spoolKey(x) === spoolKey(f);
  const twins = isNew ? [] : others.filter((x) => sameName(x) && String(x.hex).toUpperCase() === String(f.hex).toUpperCase());
  const cousins = isNew ? [] : others.filter((x) => sameName(x) && String(x.hex).toUpperCase() !== String(f.hex).toUpperCase());
  const clean = () => {
    const pr = parseFloat(String(f.price).replace(',', '.'));
    const wt = parseInt(String(f.weight).replace(/[^0-9]/g, ''), 10);
    const weight = wt > 0 ? wt : 1000;
    const count = Math.max(0, Math.floor(Number(f.count) || 0));
    const rawLeft = String(f.remaining == null ? '' : f.remaining).trim();
    let remaining = rawLeft === '' ? null : Math.round(Number(rawLeft.replace(/[^0-9.]/g, '')));
    if (remaining != null && (!Number.isFinite(remaining) || remaining < 0)) remaining = null;
    if (remaining != null) remaining = Math.min(remaining, weight);
    if (count <= 0) remaining = null;
    const next = { ...f, colorName: f.colorName.trim(), material: f.material.trim(), notes: f.notes.trim(), location: f.location.trim(),
      price: Number.isFinite(pr) && pr >= 0 ? Math.round(pr * 100) / 100 : null, weight, count };
    if (remaining == null) delete next.remaining; else next.remaining = remaining;
    return next;
  };
  const previewWeight = parseInt(String(f.weight).replace(/[^0-9]/g, ''), 10) || 1000;
  const previewLeft = String(f.remaining == null ? '' : f.remaining).trim();
  const previewRemaining = previewLeft === '' ? null : Number(previewLeft);
  const doLabel = () => {
    const s = clean();
    if (printLabel(s)) return;
    const text = labelText(s);
    const p = navigator.clipboard && navigator.clipboard.writeText(text);
    if (p) p.then(() => toast('Copied a label. Allow pop-ups to print it.')).catch(() => toast('Allow pop-ups to print a label'));
    else toast('Allow pop-ups to print a label');
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(clean()); }}>
      {isNew && (
        <button type="button" className="catalog-btn" onClick={() => setCatOpen(true)}>
          {I.search}
          <span><strong>Find it in the catalog</strong><small>Fills in name, color, brand and material</small></span>
          {I.chev}
        </button>
      )}
      {catOpen && <CatalogSheet myBrands={brands} onPick={pick} onClose={() => setCatOpen(false)} />}
      <div className="form-hero">
        <Spool hex={f.hex} count={Math.max(f.count, 0)} material={f.material} colorName={f.colorName} size={112} remaining={Number.isFinite(previewRemaining) ? previewRemaining : null} weight={previewWeight} />
        <div className="form-hero-text">
          <label className="field">
            <span>Color name</span>
            <input value={f.colorName} maxLength={120} placeholder="Sky Blue" autoComplete="off" autoCapitalize="words" enterKeyHint="done"
              onChange={(e) => {
                autoName.current = false;
                const colorName = e.target.value;
                setF((p) => {
                  const next = { ...p, colorName };
                  const guessed = hexFromName(colorName);
                  if (guessed && !hexMatchesName(colorName, p.hex)) next.hex = guessed;
                  return next;
                });
              }} />
          </label>
        </div>
      </div>

      <fieldset className="group">
        <legend>Color</legend>
        <ColorPicker hex={f.hex} onChange={(h) => set('hex', h)}
          onPreset={(name) => { if (autoName.current || !f.colorName.trim()) { autoName.current = true; set('colorName', name); } }}
          onGuess={(name) => { if (autoName.current || !f.colorName.trim()) { autoName.current = true; set('colorName', name); } }} />
      </fieldset>

      <fieldset className="group">
        <legend>Brand</legend>
        <div className="chipwrap">
          {brands.map((b) => (
            <button type="button" key={b} className={'chip' + (f.brand === b ? ' on' : '')} aria-pressed={f.brand === b} onClick={() => set('brand', b)}>{b}</button>
          ))}
          {newBrand === null && <button type="button" className="chip dashed" onClick={() => setNewBrand('')}>{I.plus} New brand</button>}
        </div>
        {newBrand !== null && (
          <div className="inline-add">
            <input autoFocus value={newBrand} maxLength={80} placeholder="Brand name" autoCapitalize="words" enterKeyHint="done" onChange={(e) => setNewBrand(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } }} />
            <button type="button" className="btn small primary" onClick={addBrand} disabled={!newBrand.trim()}>Add brand</button>
            <button type="button" className="btn small ghost" onClick={() => setNewBrand(null)}>Cancel</button>
          </div>
        )}
      </fieldset>

      <div className="two">
        <label className="field">
          <span>Material</span>
          <select value={customMat ? '__custom' : f.material}
            onChange={(e) => { if (e.target.value === '__custom') { setCustomMat(true); set('material', ''); } else { setCustomMat(false); set('material', e.target.value); } }}>
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
            <option value="__custom">Custom…</option>
          </select>
        </label>
        <div className="field">
          <span id="cnt-l">Spools</span>
          <div className="stepper in-form" role="group" aria-labelledby="cnt-l">
            <button type="button" onClick={() => set('count', Math.max(0, f.count - 1))} disabled={f.count <= 0} aria-label="One fewer">{I.minus}</button>
            <output>{f.count}</output>
            <button type="button" onClick={() => set('count', f.count + 1)} aria-label="One more">{I.plus}</button>
          </div>
        </div>
      </div>
      {customMat && (
        <label className="field">
          <span>Custom material</span>
          <input value={f.material} maxLength={40} placeholder="PA-CF, PVB, wood fill…" onChange={(e) => set('material', e.target.value)} />
        </label>
      )}

      <div>
        <button type="button" className="link-btn" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? 'Hide extra details' : 'Add location, price, and weight'}
        </button>
        {more && (
          <div className="more">
            <label className="field">
              <span>Where is it? <em>optional</em></span>
              <input list="fs-locs" value={f.location} maxLength={40} placeholder="AMS slot 1, drybox, shelf B" autoComplete="off" onChange={(e) => set('location', e.target.value)} />
              <datalist id="fs-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </label>
            <div className="two">
              <label className="field">
                <span>Price per spool <em>$</em></span>
                <input inputMode="decimal" value={f.price} placeholder="19.99" autoComplete="off" onChange={(e) => set('price', e.target.value)} />
              </label>
              <label className="field">
                <span>Spool size <em>grams</em></span>
                <input inputMode="numeric" value={f.weight} placeholder="1000" autoComplete="off" onChange={(e) => set('weight', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Grams left on the open spool <em>optional</em></span>
              <input inputMode="numeric" value={f.remaining} placeholder="Full spool" autoComplete="off" onChange={(e) => set('remaining', e.target.value)} />
            </label>
          </div>
        )}
      </div>

      <label className="field">
        <span>Notes <em>optional</em></span>
        <textarea rows={2} value={f.notes} maxLength={2000} placeholder="Nozzle temp, what it's for, where you bought it" onChange={(e) => set('notes', e.target.value)} />
      </label>

      {f.colorName.trim() && <div className="row-btns"><button type="button" className="btn ghost" onClick={doLabel}>Print label</button></div>}

      {!isNew && twins.length > 0 && (
        <button type="button" className="btn ghost full" onClick={() => onCombine(clean(), twins)}>
          {twins.length === 1 ? 'Combine with the other ' + f.colorName.trim() : 'Combine with ' + twins.length + ' other copies'}
        </button>
      )}
      {!isNew && cousins.length > 0 && (
        <p className="fine">Another {f.colorName.trim()} uses a different color, so it stays its own row.</p>
      )}

      <div className="form-actions">
        {!isNew && <button type="button" className="btn ghost danger-text" onClick={onDelete}>Delete</button>}
        {!isNew && <button type="button" className="btn ghost sq" onClick={() => onDuplicate(clean())} aria-label="Duplicate as a new spool" title="Duplicate">{I.dup}</button>}
        <button className="btn primary grow" disabled={!ok}>{isNew ? 'Add to shelf' : 'Save changes'}</button>
      </div>
    </form>
  );
}

/* ---------- brands ---------- */
function BrandsManager({ state, commit, toast }) {
  const [editing, setEditing] = useState(null);
  const [val, setVal] = useState('');
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState('');
  const uses = (b) => state.spools.filter((s) => s.brand === b).length;
  const rename = (old) => {
    const n = val.trim();
    if (!n || n === old) { setEditing(null); return; }
    if (state.brands.some((b) => b !== old && b.toLowerCase() === n.toLowerCase())) { setMsg({ b: old, t: 'There is already a brand called ' + n + '.' }); return; }
    commit((s) => ({ ...s, brands: s.brands.map((b) => (b === old ? n : b)), spools: s.spools.map((x) => (x.brand === old ? { ...x, brand: n } : x)) }));
    setEditing(null); setMsg(null); toast('Renamed to ' + n);
  };
  const del = (b) => {
    const n = uses(b);
    if (n) { setMsg({ b, t: plural(n, 'color') + ' on your shelf ' + (n === 1 ? 'uses' : 'use') + ' this brand. Move or delete ' + (n === 1 ? 'it' : 'them') + ' first.' }); return; }
    commit((s) => ({ ...s, brands: s.brands.filter((x) => x !== b) })); setMsg(null); toast('Deleted ' + b);
  };
  const addBrand = () => {
    const n = add.trim(); if (!n) return;
    if (state.brands.some((b) => b.toLowerCase() === n.toLowerCase())) { setMsg({ b: '__add', t: 'That brand is already on the list.' }); return; }
    commit((s) => ({ ...s, brands: [...s.brands, n] })); setAdd(''); setMsg(null);
  };
  return (
    <div className="brands">
      {state.brands.length === 0 && <p className="lead">No brands yet. Add the first one below.</p>}
      <ul>
        {state.brands.map((b) => (
          <li key={b}>
            {editing === b ? (
              <div className="inline-add">
                <input autoFocus value={val} maxLength={80} onChange={(e) => setVal(e.target.value)} aria-label={'New name for ' + b}
                  onKeyDown={(e) => { if (e.key === 'Enter') rename(b); }} />
                <button className="btn small primary" onClick={() => rename(b)}>Save name</button>
                <button className="btn small ghost" onClick={() => { setEditing(null); setMsg(null); }}>Cancel</button>
              </div>
            ) : (
              <div className="brand-row">
                <div><strong>{b}</strong><small>{uses(b) ? plural(uses(b), 'color') : 'Not used yet'}</small></div>
                <button className="btn small ghost" onClick={() => { setEditing(b); setVal(b); setMsg(null); }}>Rename</button>
                <button className="btn small ghost danger-text" onClick={() => del(b)}>Delete</button>
              </div>
            )}
            {msg && msg.b === b && <p className="note warn">{I.warn}<span>{msg.t}</span></p>}
          </li>
        ))}
      </ul>
      <div className="inline-add add-brand">
        <input value={add} maxLength={80} placeholder="Add a brand" onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBrand(); }} aria-label="New brand name" />
        <button className="btn small primary" onClick={addBrand} disabled={!add.trim()}>Add brand</button>
      </div>
      {msg && msg.b === '__add' && <p className="note warn">{I.warn}<span>{msg.t}</span></p>}
      {(() => {
        const sug = SUGGESTED_BRANDS.filter((b) => !state.brands.some((x) => x.toLowerCase() === b.toLowerCase()));
        if (!sug.length) return null;
        return (
          <div className="suggest">
            <p className="fine">Popular brands, one tap to add</p>
            <div className="chipwrap">
              {sug.map((b) => <button key={b} className="chip dashed" onClick={() => commit((s) => ({ ...s, brands: [...s.brands, b] }))}>{I.plus}{b}</button>)}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ---------- backup ---------- */
function ExportSheet({ state, toast }) {
  const [fmt, setFmt] = useState('json');
  const json = useMemo(() => JSON.stringify({ version: 1, brands: state.brands, spools: state.spools, settings: state.settings, updatedAt: state.updatedAt }, null, 2), [state]);
  const csv = useMemo(() => toCsv(state), [state]);
  const text = fmt === 'csv' ? csv : json;
  const [dl, setDl] = useState(null);
  const [note, setNote] = useState('');
  const ta = useRef(null);
  useEffect(() => { let on = true; getDownloads().then((d) => { if (on && d && typeof d.save === 'function') setDl(d); }); return () => { on = false; }; }, []);
  const copy = () => {
    let p;
    try { p = navigator.clipboard.writeText(text); } catch (e) { p = Promise.reject(e); }
    p.then(() => { toast(fmt === 'csv' ? 'Copied spreadsheet' : 'Copied backup'); setNote(''); }).catch(() => {
      try { ta.current.focus(); ta.current.select(); } catch (e) {}
      setNote('Copying is blocked here. The text is selected, so use your device’s Copy.');
    });
  };
  const save = async () => {
    try { await dl.save({ filename: fmt === 'csv' ? 'filament-shelf.csv' : 'filament-backup.json', data: text }); toast('Saved file'); }
    catch (e) { setNote('The file could not be saved. Copy the text instead.'); }
  };
  return (
    <div>
      <div className="seg-ctl two" role="radiogroup" aria-label="Export format">
        {[['json', 'Backup (JSON)'], ['csv', 'Spreadsheet (CSV)']].map(([k, l]) => (
          <button key={k} role="radio" aria-checked={fmt === k} className={fmt === k ? 'on' : ''} onClick={() => { setFmt(k); setNote(''); }}>{l}</button>
        ))}
      </div>
      <p className="lead gap">{fmt === 'csv'
        ? 'One row per color, ready for Excel, Numbers or Google Sheets. You can import it back later.'
        : 'This is your whole shelf: ' + plural(state.spools.length, 'color') + ' and ' + plural(state.brands.length, 'brand') + '. Keep a copy somewhere safe.'}</p>
      <textarea ref={ta} className="code" readOnly value={text} rows={9} aria-label="Export text" onFocus={(e) => e.target.select()} />
      {note && <p className="note warn">{I.warn}<span>{note}</span></p>}
      <div className="row-btns">
        {dl && <button className="btn ghost" onClick={save}>Save file</button>}
        <button className="btn primary" onClick={copy}>Copy</button>
      </div>
    </div>
  );
}

function ImportSheet({ state, commit, toast, onDone }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [parsed, setParsed] = useState(null);
  const check = (t) => {
    setErr(''); setParsed(null);
    try { setParsed(parseBackup(t)); }
    catch (e) { setErr(e instanceof SyntaxError ? 'That text is not valid JSON. Paste the whole backup, from the first { to the last }.' : e.message); }
  };
  const file = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { const t = String(r.result || ''); setText(t); check(t); };
    r.onerror = () => setErr('That file could not be read.');
    r.readAsText(f); e.target.value = '';
  };
  const replace = () => {
    const before = state;
    commit((s) => ({ ...s, version: 1, brands: parsed.brands, spools: parsed.spools, hideSampleNote: !parsed.spools.some((x) => x.isSample) }));
    toast('Replaced your shelf', { label: 'Undo', run: () => commit(() => before) }); onDone();
  };
  const merge = () => {
    const before = state;
    commit((s) => {
      const spools = [...s.spools];
      const byId = new Map(spools.map((x, i) => [x.id, i]));
      const byKey = new Map(spools.map((x, i) => [spoolKey(x), i]));
      parsed.spools.forEach((x) => {
        const i = byId.has(x.id) ? byId.get(x.id) : byKey.get(spoolKey(x));
        if (i != null) spools[i] = { ...x, id: spools[i].id };
        else { byId.set(x.id, spools.length); byKey.set(spoolKey(x), spools.length); spools.push(x); }
      });
      const brands = [...s.brands];
      [...parsed.brands, ...parsed.spools.map((x) => x.brand)].forEach((b) => { if (!brands.some((x) => x.toLowerCase() === b.toLowerCase())) brands.push(b); });
      return { ...s, brands, spools };
    });
    toast('Merged ' + plural(parsed.spools.length, 'color'), { label: 'Undo', run: () => commit(() => before) }); onDone();
  };
  return (
    <div>
      {!parsed ? (
        <>
          <p className="lead">Paste a backup or spreadsheet, or choose a .json or .csv file. A CSV needs a header row such as Brand, Material, Color, Hex, Spools.</p>
          <textarea className="code" rows={7} value={text} placeholder={'{ "version": 1, "brands": [...], "spools": [...] }'} onChange={(e) => { setText(e.target.value); setErr(''); }} aria-label="Backup text" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          {err && <p className="note warn">{I.warn}<span>{err}</span></p>}
          <div className="row-btns">
            <label className="btn ghost filebtn">Choose file<input type="file" accept=".json,.csv,application/json,text/csv" onChange={file} /></label>
            <button className="btn primary" disabled={!text.trim()} onClick={() => check(text)}>Check backup</button>
          </div>
        </>
      ) : (
        <>
          <p className="lead">This backup holds {plural(parsed.spools.length, 'color')} ({plural(parsed.spools.reduce((a, x) => a + x.count, 0), 'spool')}) across {plural(parsed.brands.length, 'brand')}.</p>
          <div className="strand small">{[...parsed.spools].sort((a, b) => hueKey(a.hex) - hueKey(b.hex)).map((x) => <i key={x.id} className={isRainbow(x.hex) ? 'swatch-rainbow' : undefined} style={{ background: isRainbow(x.hex) ? undefined : x.hex, flexGrow: Math.max(x.count, 0.4) }} />)}</div>
          <div className="choice">
            <button className="choice-btn" onClick={merge}>
              <strong>Merge with shelf</strong>
              <small>Keeps your {plural(state.spools.length, 'color')} and adds these. Colors with the same brand, material and name are updated instead of doubled.</small>
            </button>
            <button className="choice-btn danger" onClick={replace}>
              <strong>Replace everything</strong>
              <small>Removes what is on your shelf now and loads only this backup. You can undo right after.</small>
            </button>
          </div>
          <button className="btn ghost full" onClick={() => setParsed(null)}>Back</button>
        </>
      )}
    </div>
  );
}

/* ---------- insights ---------- */
function Readout({ s, hint }) {
  if (!s) return <p className="readout hint">{hint}</p>;
  return (
    <p className="readout">
      <span className={'dot' + (isRainbow(s.hex) ? ' swatch-rainbow' : '')} style={isRainbow(s.hex) ? undefined : { background: s.hex }} />
      <strong>{s.colorName}</strong>
      <span>{s.brand}, {s.material}</span>
      <b>{s.count ? plural(s.count, 'spool') : 'Out'}</b>
    </p>
  );
}

function ColorWheel({ spools }) {
  const [sel, setSel] = useState(null);
  const S = 320, C = S / 2, RM = 118;
  const nodes = useMemo(() => {
    const ns = spools.map((s) => {
      const rain = isRainbow(s.hex);
      const { h, s: sat, v } = rain ? { h: 0, s: 0, v: 1 } : hexToHsv(s.hex);
      const rad = sat * (0.45 + 0.55 * v) * RM;
      const a = ((h - 90) * Math.PI) / 180;
      return { s, x: C + rad * Math.cos(a), y: C + rad * Math.sin(a) - (sat < 0.14 ? (v - 0.5) * 34 : 0), r: s.count ? 8 + 7.5 * Math.sqrt(s.count) : 9 };
    });
    for (let it = 0; it < 80; it++) {
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const min = a.r + b.r + 3;
        if (d < min) {
          if (d < 0.01) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); d = 1; }
          const p = (min - d) / 2; dx /= d; dy /= d;
          a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p;
        }
      }
      ns.forEach((n) => {
        const dx = n.x - C, dy = n.y - C, d = Math.hypot(dx, dy), max = RM + 8 - n.r;
        if (d > max && d > 0) { n.x = C + (dx / d) * max; n.y = C + (dy / d) * max; }
      });
    }
    return ns.sort((a, b) => b.r - a.r);
  }, [spools]);
  const cur = nodes.find((n) => n.s.id === sel);
  return (
    <div className="wheel-wrap">
      <div className="wheel">
        <div className="wheel-ring" aria-hidden="true" />
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Your colors placed around a color wheel, sized by spool count">
          <circle cx={C} cy={C} r={RM * 0.5} className="guide" />
          <circle cx={C} cy={C} r={2} className="guide-dot" />
          {nodes.map((n) => (
            <g key={n.s.id} className={'bub' + (sel && sel !== n.s.id ? ' dim' : '')} onClick={() => setSel(sel === n.s.id ? null : n.s.id)}
              tabIndex={0} role="button" aria-label={`${n.s.colorName}, ${n.s.brand}, ${plural(n.s.count, 'spool')}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(n.s.id); } }}>
              <circle cx={n.x} cy={n.y} r={Math.max(n.r + 4, 22)} fill="transparent" />
              {n.s.count ? (
                <>
                  <circle cx={n.x} cy={n.y} r={n.r + 2} className="bub-gap" />
                  {isRainbow(n.s.hex) ? <g className="bub-fill">{rainbowWedges(n.x, n.y, n.r)}</g> : <circle cx={n.x} cy={n.y} r={n.r} fill={n.s.hex} className="bub-fill" />}
                </>
              ) : (
                isRainbow(n.s.hex) ? <g>{rainbowWedges(n.x, n.y, Math.max(4, n.r - 2))}</g> : <circle cx={n.x} cy={n.y} r={n.r - 2} fill="none" stroke={n.s.hex} strokeWidth="3.5" strokeDasharray="4 3" />
              )}
              {sel === n.s.id && <circle cx={n.x} cy={n.y} r={n.r + 5} className="bub-sel" />}
            </g>
          ))}
        </svg>
      </div>
      <Readout s={cur && cur.s} hint="Vivid colors sit near the rim, greys and whites in the middle. Bigger dot, more spools. Tap one." />
    </div>
  );
}

function BrandBars({ spools, brands, selected, onToggle }) {
  const [sel, setSel] = useState(null);
  const picked = selected || [];
  const rows = useMemo(() => brandsInUse(brands, spools).map((b) => {
    const list = spools.filter((s) => sameBrand(s.brand, b)).sort((x, y) => hueKey(x.hex) - hueKey(y.hex));
    return { b, list, total: list.reduce((a, s) => a + s.count, 0) };
  }), [spools, brands]);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const cur = spools.find((s) => s.id === sel);
  return (
    <div>
      <div className="bars">
        {rows.map((r) => {
          const on = picked.some((b) => sameBrand(b, r.b));
          return (
            <div className={'bar-row' + (picked.length && !on ? ' dim' : '')} key={r.b}>
              <div className="bar-label">
                <button type="button" className={'bar-name' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onToggle(r.b)}>
                  {r.b}
                </button>
                <b>{r.total}</b>
              </div>
              <div className="bar-track">
                <div className="bar" style={{ width: (r.total / max) * 100 + '%' }}>
                  {r.list.filter((s) => s.count > 0).map((s) => (
                    <button key={s.id} className={'seg' + (isRainbow(s.hex) ? ' swatch-rainbow' : '') + (sel && sel !== s.id ? ' dim' : '') + (sel === s.id ? ' on' : '')} style={{ flexGrow: s.count, background: isRainbow(s.hex) ? undefined : s.hex }}
                      onClick={() => setSel(sel === s.id ? null : s.id)} aria-label={`${s.colorName}, ${plural(s.count, 'spool')}`} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Readout s={cur} hint="Tap a brand to filter the shelf to that company. Tap a block for one color." />
    </div>
  );
}

function MaterialDonut({ spools, dark }) {
  const [sel, setSel] = useState(null);
  const data = useMemo(() => {
    const out = MATERIALS.map((m) => ({ name: m, value: spools.filter((s) => s.material === m).reduce((a, s) => a + s.count, 0), color: materialTone(m).fill }));
    const other = spools.filter((s) => !MATERIALS.includes(s.material)).reduce((a, s) => a + s.count, 0);
    if (other) out.push({ name: 'Other', value: other, color: dark ? OTHER.dark : OTHER.light });
    return out.filter((d) => d.value > 0);
  }, [spools, dark]);
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <p className="readout hint">Every spool is out, so there is nothing to split by material yet.</p>;
  const cur = data.find((d) => d.name === sel);
  return (
    <div className="donut-wrap">
      <div className="donut">
        <PieChart width={164} height={164}>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={53} outerRadius={80} startAngle={90} endAngle={-270}
            paddingAngle={data.length > 1 ? 2.5 : 0} cornerRadius={4} stroke="none" isAnimationActive={false}
            onClick={(d) => setSel(sel === d.name ? null : d.name)}>
            {data.map((d) => <Cell key={d.name} fill={d.color} opacity={sel && sel !== d.name ? 0.25 : 1} style={{ cursor: 'pointer', outline: 'none', transition: 'opacity .2s' }} />)}
          </Pie>
        </PieChart>
        <div className="donut-mid" aria-live="polite">
          <b>{cur ? cur.value : total}</b>
          <span>{cur ? cur.name : total === 1 ? 'spool' : 'spools'}</span>
        </div>
      </div>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.name}>
            <button className={sel === d.name ? 'on' : sel ? 'dim' : ''} onClick={() => setSel(sel === d.name ? null : d.name)} aria-pressed={sel === d.name}>
              <i style={{ background: d.color }} /><span>{d.name}</span><b>{d.value}</b><em>{Math.round((d.value / total) * 100)}%</em>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShopNote({ brand, shop, onSave }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(shop ? shop.note : '');
  const [url, setUrl] = useState(shop ? shop.url : '');
  const save = (e) => {
    e.preventDefault();
    onSave(brand, note, url);
    setOpen(false);
  };
  return (
    <div className="shop-note">
      {shop && shop.url ? <a href={shop.url} target="_blank" rel="noopener noreferrer">{shop.note || shop.url}</a> : shop && shop.note ? <p>{shop.note}</p> : null}
      <button type="button" className="link-btn" onClick={() => { setNote(shop ? shop.note : ''); setUrl(shop ? shop.url : ''); setOpen(!open); }} aria-expanded={open}>
        {open ? 'Close note' : shop ? 'Edit reorder note' : 'Add a reorder note'}
      </button>
      {open && (
        <form onSubmit={save}>
          <label className="field">
            <span>Note for {brand}</span>
            <input value={note} maxLength={120} placeholder="Usual shop, or a reminder" autoComplete="off" onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="field">
            <span>Link <em>optional</em></span>
            <input value={url} maxLength={200} inputMode="url" placeholder="https://" autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button className="btn small primary" type="submit">Save note</button>
        </form>
      )}
    </div>
  );
}

function Insights({ state, dark, onAdd, onBump, onRestock, toast, brandsOn, onToggleBrand, onClearBrands, onSaveShop }) {
  const brandsOnSafe = brandsOn || [];
  const all = state.spools;
  const spools = brandsOnSafe.length ? all.filter((s) => brandsOnSafe.some((b) => sameBrand(s.brand, b))) : all;
  if (!spools.length) {
    return (
      <div className="empty">
        <Spool hex="#888888" count={0} size={120} />
        <h2>Nothing to chart yet</h2>
        <p>Add a spool and your color wheel starts filling in.</p>
        <button className="btn primary" onClick={onAdd}>Add a spool</button>
      </div>
    );
  }
  const lowAt = state.settings ? state.settings.lowAt : 1;
  const lowGrams = state.settings && Number.isFinite(state.settings.lowGrams) ? state.settings.lowGrams : 200;
  const strand = [...spools].filter((s) => s.count > 0).sort((a, b) => hueKey(a.hex) - hueKey(b.hex));
  const outs = spools.filter((s) => s.count === 0);
  const low = spools.filter((s) => s.count > 0 && needsRestock(s, state.settings));
  const need = outs.length + low.length;
  const grams = spools.reduce((a, s) => a + gramsOnHand(s), 0);
  const priced = spools.filter((s) => s.price != null && s.count > 0);
  const value = priced.reduce((a, s) => a + spoolValue(s), 0);
  const shops = state.settings && state.settings.shops || [];
  const order = [...outs, ...low];
  const byBrand = [];
  for (const s of order) {
    let g = byBrand.find((x) => sameBrand(x.brand, s.brand));
    if (!g) { g = { brand: s.brand, items: [] }; byBrand.push(g); }
    g.items.push(s);
  }
  byBrand.sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));
  const copyList = () => {
    const text = restockText(spools, state.settings, shops);
    const p = navigator.clipboard && navigator.clipboard.writeText(text);
    if (p) p.then(() => toast('Copied the shopping list')).catch(() => toast('Copying is blocked in this browser'));
    else toast('Copying is blocked in this browser');
  };
  return (
    <div className="insights">
      <section className="kpis" aria-label="Stock summary">
        <div className="kpi"><b>{kg(grams)}</b><span>on hand</span></div>
        {priced.length > 0 && <div className="kpi"><b>{money(value)}</b><span>{priced.length < spools.length ? 'in priced colors' : 'of filament'}</span></div>}
        <button className={'kpi' + (need ? ' warn' : '')} onClick={onRestock} disabled={!need}><b>{need}</b><span>{need ? 'to restock, show me' : 'to restock'}</span></button>
      </section>
      <div className="col">
        <section className="panel">
          <h2>Your colors</h2>
          <p className="sub">{brandsOnSafe.length ? brandsOnSafe.join(' · ') + ' · ' : ''}{plural(new Set(spools.map((s) => s.hex.toUpperCase())).size, 'color')} across {plural(spools.reduce((a, s) => a + s.count, 0), 'spool')}</p>
          {strand.length > 0 && (
            <div className="strand" role="img" aria-label="All your spools laid end to end in rainbow order">
              {strand.map((s) => <i key={s.id} className={isRainbow(s.hex) ? 'swatch-rainbow' : undefined} style={{ background: isRainbow(s.hex) ? undefined : s.hex, flexGrow: s.count }} title={s.colorName} />)}
            </div>
          )}
          <ColorWheel spools={spools} />
        </section>
        <section className="panel">
          <h2>Spools by material</h2>
          <p className="sub">Tap a slice or a row to single it out</p>
          <MaterialDonut spools={spools} dark={dark} />
        </section>
      </div>
      <div className="col">
        <section className="panel">
          <h2>Spools by brand</h2>
          <div className="subline">
            <p className="sub">Tap a company to show only that brand.</p>
            {brandsOnSafe.length > 0 && <button type="button" className="link-btn" onClick={onClearBrands}>Show every brand</button>}
          </div>
          <BrandBars spools={all} brands={state.brands} selected={brandsOnSafe} onToggle={onToggleBrand} />
        </section>
        <section className="panel">
          <h2>Restock list</h2>
          {need === 0 ? <p className="sub">Nothing is running low.</p> : (
            <>
              <p className="sub">{outs.length ? plural(outs.length, 'color') + ' out' : 'Nothing out'}{low.length ? ', ' + low.length + ' low' : ''}</p>
              <div className="restock">
                {byBrand.map((g) => {
                  const onHand = g.items.reduce((a, s) => a + s.count, 0);
                  const shop = shops.find((sh) => sameBrand(sh.brand, g.brand));
                  return (
                    <section key={g.brand} className="restock-brand">
                      <header>
                        <strong>{g.brand}</strong>
                        <small>{plural(g.items.length, 'color')} · {onHand === 1 ? '1 spool on hand' : onHand + ' spools on hand'}</small>
                      </header>
                      <ShopNote brand={g.brand} shop={shop} onSave={onSaveShop} />
                      <ul>
                        {g.items.map((s) => {
                          const gramsHit = s.count > 0 && lowGrams > 0 && s.remaining != null && s.remaining <= lowGrams;
                          return (
                            <li key={s.id}>
                              <Spool hex={s.hex} count={s.count} material={s.material} colorName={s.colorName} size={44} remaining={s.remaining} weight={s.weight} />
                              <div><strong>{s.colorName}</strong><small>{s.material}</small></div>
                              {s.count === 0 ? <span className="badge out">{I.warn}Out</span> : gramsHit ? <span className="badge low">{s.remaining} g</span> : <span className="badge low">{s.count === 1 ? 'Last spool' : s.count + ' left'}</span>}
                              <button className="mini-plus" onClick={() => onBump(s.id, 1)} aria-label={'Add a spool of ' + s.colorName}>{I.plus}</button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
              <button className="btn ghost full" type="button" onClick={copyList}>Copy shopping list</button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- shelf ---------- */
function Cell_({ s, onEdit, onBump, intro, i, settings }) {
  const lowAt = settings && Number.isFinite(settings.lowAt) ? settings.lowAt : 1;
  const lowGrams = settings && Number.isFinite(settings.lowGrams) ? settings.lowGrams : 200;
  const out = s.count === 0;
  const gramsLow = !out && lowGrams > 0 && s.remaining != null && s.remaining <= lowGrams;
  const low = !out && !gramsLow && s.count <= lowAt;
  const tone = materialTone(s.material);
  return (
    <article className={'cell' + (out ? ' out' : '')}>
      <button className={'cell-top' + (intro ? ' roll' : '')} style={intro ? { animationDelay: Math.min(i, 12) * 45 + 'ms' } : null} onClick={() => onEdit(s)} aria-label={'Edit ' + s.colorName}>
        <Spool hex={s.hex} count={s.count} material={s.material} colorName={s.colorName} size={118} remaining={s.remaining} weight={s.weight} />
      </button>
      <div className="plank" aria-hidden="true" />
      <div className="cell-info" onClick={() => onEdit(s)}>
        <h3>{s.colorName}</h3>
        <p className="brand">{s.brand}</p>
        <p className="tags">
          <span className="badge mat" style={{ '--mat-soft': tone.soft, '--mat-ink': tone.ink, '--mat-bright': tone.bright }}>{s.material}</span>
          {s.location && <span className="tag loc">{I.pin}{s.location}</span>}
          {s.remaining != null && s.count > 0 && !gramsLow && <span className="tag">{s.remaining} g</span>}
          {out && <span className="badge out">{I.warn}Out — restock</span>}
          {gramsLow && <span className="badge low">{s.remaining} g left</span>}
          {low && <span className="badge low">{s.count === 1 ? 'Last spool' : 'Low'}</span>}
        </p>
        {s.notes && <p className="notes">{s.notes}</p>}
      </div>
      <div className="stepper" role="group" aria-label={'Spools of ' + s.colorName}>
        <button onClick={() => onBump(s.id, -1)} disabled={out} aria-label="One fewer">{I.minus}</button>
        <output key={s.count} aria-live="polite">{s.count}</output>
        <button onClick={() => onBump(s.id, 1)} aria-label="One more">{I.plus}</button>
      </div>
    </article>
  );
}

/* ---------- account ---------- */
function AccountSheet({ toast }) {
  const who = server();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const short = pw.length > 0 && pw.length < 8;
  const mismatch = again.length > 0 && pw !== again;
  const save = async (e) => {
    e.preventDefault();
    if (short || mismatch || pw.length < 8 || busy) return;
    setBusy(true); setMsg('');
    const res = await changePassword(cur, pw);
    setBusy(false);
    if (res === 'ok') { setCur(''); setPw(''); setAgain(''); toast('Password changed. Other devices were signed out.'); return; }
    if (res === 'wrong') { setMsg('That current password is wrong.'); return; }
    if (res === 'short') { setMsg('Use at least 8 characters.'); return; }
    if (res === 'signedout') { window.location.assign('/login'); return; }
    setMsg('The password could not be changed. Try again.');
  };
  const others = async () => {
    setBusy(true); setMsg('');
    const res = await signOutOthers();
    setBusy(false);
    if (res === 'ok') { toast('Signed out on every other device.'); return; }
    if (res === 'signedout') { window.location.assign('/login'); return; }
    setMsg('Those devices could not be signed out. Try again.');
  };
  return (
    <form className="form" onSubmit={save}>
      <p className="lead">Signed in as {who ? (who.name || who.user) : 'you'}. Your password is stored as a protected copy. Changing it signs you out on every other device.</p>
      <label className="field"><span>Current password</span>
        <input type="password" value={cur} autoComplete="current-password" maxLength={1024} onChange={(e) => { setCur(e.target.value); setMsg(''); }} /></label>
      <label className="field"><span>New password</span>
        <input type="password" value={pw} autoComplete="new-password" maxLength={1024} onChange={(e) => { setPw(e.target.value); setMsg(''); }} /></label>
      <label className="field"><span>Type it again</span>
        <input type="password" value={again} autoComplete="new-password" maxLength={1024} onChange={(e) => { setAgain(e.target.value); setMsg(''); }} /></label>
      {short && <p className="note warn">{I.warn}<span>Use at least 8 characters.</span></p>}
      {mismatch && <p className="note warn">{I.warn}<span>The passwords did not match.</span></p>}
      {msg && <p className="note warn" role="alert">{I.warn}<span>{msg}</span></p>}
      <div className="form-actions">
        <button className="btn primary grow" disabled={busy || pw.length < 8 || pw !== again || !cur}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
      <button type="button" className="btn ghost full" onClick={others} disabled={busy}>Sign out other devices</button>
    </form>
  );
}

/* ---------- app ---------- */
export default function App() {
  const [state, setState] = useState(loadInitial);
  const [tab, setTab] = useState(() => ss.get('fs-tab', 'shelf'));
  const [q, setQ] = useState(() => ss.get('fs-q', ''));
  const [sort, setSort] = useState(() => ss.get('fs-sort', 'hue'));
  const [fb, setFb] = useState(() => ss.get('fs-fb', []));
  const [fm, setFm] = useState(() => ss.get('fs-fm', []));
  const [fl, setFl] = useState(() => ss.get('fs-fl', []));
  const [fr, setFr] = useState(() => ss.get('fs-fr', false));
  const [filterGroup, setFilterGroup] = useState(() => ss.get('fs-fg', 'brand'));
  const [sheet, setSheet] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [dirty, setDirty] = useState(() => (bootStatus() === 'clean' ? 0 : 1));
  const [mode, setMode] = useState(() => (bootStatus() === 'conflict' ? 'conflict' : 'unknown')); // unknown | cloud | device | viewonly
  const [saving, setSaving] = useState(false);
  const [intro] = useState(() => { const seen = ss.get('fs-seen', false); ss.set('fs-seen', true); return !seen; });
  const dark = useDark();
  const stateRef = useRef(state); stateRef.current = state;
  const publishing = useRef(false);
  const searchRef = useRef(null);
  const bgRef = useRef(null);
  const lowAt = state.settings && Number.isFinite(state.settings.lowAt) ? state.settings.lowAt : 1;
  const lowGrams = state.settings && Number.isFinite(state.settings.lowGrams) ? state.settings.lowGrams : 200;

  useEffect(() => { ss.set('fs-tab', tab); ss.set('fs-q', q); ss.set('fs-sort', sort); ss.set('fs-fb', fb); ss.set('fs-fm', fm); ss.set('fs-fl', fl); ss.set('fs-fr', fr); ss.set('fs-fg', filterGroup); }, [tab, q, sort, fb, fm, fl, fr, filterGroup]);
  useEffect(() => {
    const y = ss.get('fs-y', 0); if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    let t; const f = () => { clearTimeout(t); t = setTimeout(() => ss.set('fs-y', window.scrollY), 150); };
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  useEffect(() => { let on = true; waitForClaude().then((ok) => { if (on) setMode((m) => (m === 'unknown' ? (ok ? 'cloud' : 'device') : m)); }); return () => { on = false; }; }, []);

  const toast = useCallback((t, action) => { setToastMsg({ t, k: Date.now(), action: action || null }); }, []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(null), toastMsg.action ? 6000 : 2200); return () => clearTimeout(t); }, [toastMsg]);

  // Every user action goes through commit: stamp, save on this device now, publish later.
  const commit = useCallback((fn) => {
    setState((prev) => {
      const next = { ...fn(prev), version: 1, updatedAt: Date.now() };
      if (!next.settings) next.settings = { lowAt: 1, lowGrams: 200 };
      saveLocal(next);
      return next;
    });
    setDirty((d) => d + 1);
  }, []);

  // Debounced publish. Waits while a sheet is open so the reload never interrupts typing.
  const busy = !!sheet || !!confirm;
  useEffect(() => {
    if (!dirty || busy || mode === 'conflict' || mode === 'rejected' || mode === 'signedout') return;
    const t = setTimeout(async () => {
      if (publishing.current) return;
      publishing.current = true; setSaving(true);
      const snapshot = stateRef.current;
      saveLocal(snapshot);
      let res = 'local';
      try { res = await publish(snapshot); } catch (e) {}
      publishing.current = false; setSaving(false);
      if (server() && res !== 'published') {
        // Self-hosted: the change stays pending (also in this tab's storage). Retry network and server errors;
        // a conflict, a refused save or an expired sign-in waits for you.
        setMode({ error: 'offline', conflict: 'conflict', rejected: 'rejected', signedout: 'signedout' }[res] || 'offline');
        if (res === 'error') setTimeout(() => setDirty((d) => d + 1), 5000);
        return;
      }
      setMode(res === 'published' ? 'cloud' : res === 'viewonly' ? 'viewonly' : 'device');
      if (stateRef.current === snapshot) setDirty(0); else setDirty((d) => d + 1);
    }, 1500);
    return () => clearTimeout(t);
  }, [dirty, busy, mode]);

  // Self-hosted: pick up changes from other devices when the app comes back to the foreground,
  // and warn before closing with an unsaved change.
  useEffect(() => {
    if (!server()) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || dirty || saving || mode === 'conflict') return;
      const r = await fetchLatest();
      if (!r) return;
      if (r.signedOut) { setMode('signedout'); return; }
      if (r.rev > server().rev) { adoptRev(r.rev); setState(r.state); }
    };
    const leave = (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('beforeunload', leave);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('beforeunload', leave); };
  }, [dirty, saving, mode]);
  const keepMine = async () => {
    const r = await fetchLatest();
    if (!r || r.signedOut) { setMode(r && r.signedOut ? 'signedout' : 'offline'); setSheet(null); return; }
    adoptRev(r.rev); setMode('cloud'); setSheet(null); setDirty((d) => d + 1);
  };
  const loadLatest = () => { dropPending(); window.location.reload(); };

  // While a sheet is open the page behind it is inert (no focus, no taps, hidden from screen readers).
  useEffect(() => {
    const el = bgRef.current; if (!el) return;
    if (busy) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  }, [busy]);

  // Desktop keyboard shortcuts: / search, N new spool, 1 and 2 switch tabs.
  useEffect(() => {
    const f = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sheetStack.length) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === '/') { e.preventDefault(); setTab('shelf'); setTimeout(() => { if (searchRef.current) searchRef.current.focus(); }, 40); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setSheet({ type: 'edit', spool: null }); }
      else if (e.key === '1') setTab('shelf');
      else if (e.key === '2') setTab('insights');
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const bump = useCallback((id, d) => commit((s) => ({ ...s, spools: s.spools.map((x) => (x.id === id ? { ...x, count: Math.max(0, x.count + d) } : x)) })), [commit]);

  const stats = useMemo(() => ({
    total: state.spools.reduce((a, s) => a + s.count, 0),
    colors: new Set(state.spools.map((s) => s.hex.toUpperCase())).size,
    brands: new Set(state.spools.map((s) => s.brand)).size,
    out: state.spools.filter((s) => s.count === 0).length,
  }), [state.spools]);

  const brandChips = useMemo(() => brandsInUse(state.brands, state.spools), [state]);
  const matChips = useMemo(() => { const set = new Set(state.spools.map((s) => s.material)); return [...MATERIALS.filter((m) => set.has(m)), ...[...set].filter((m) => !MATERIALS.includes(m))]; }, [state.spools]);
  const locChips = useMemo(() => [...new Set(state.spools.map((s) => s.location).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [state.spools]);
  const needN = useMemo(() => state.spools.filter((s) => needsRestock(s, state.settings)).length, [state.spools, state.settings]);
  const aFb = activeNames(fb, brandChips), aFm = fm.filter((m) => matChips.includes(m)), aFl = fl.filter((l) => locChips.includes(l));
  const aFr = fr && needN > 0;

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    let list = state.spools.filter((s) => (!aFb.length || aFb.some((b) => sameBrand(b, s.brand))) && (!aFm.length || aFm.includes(s.material)) &&
      (!aFl.length || aFl.includes(s.location)) && (!aFr || needsRestock(s, state.settings)) &&
      (!n || (s.colorName + ' ' + s.brand + ' ' + s.notes + ' ' + s.material + ' ' + (s.location || '')).toLowerCase().includes(n)));
    const byName = (a, b) => a.colorName.localeCompare(b.colorName);
    if (sort === 'brand') list = [...list].sort((a, b) => a.brand.localeCompare(b.brand) || byName(a, b));
    else if (sort === 'count') list = [...list].sort((a, b) => b.count - a.count || byName(a, b));
    else if (sort === 'countAsc') list = [...list].sort((a, b) => a.count - b.count || byName(a, b));
    else if (sort === 'name') list = [...list].sort(byName);
    else list = [...list].sort((a, b) => hueKey(a.hex) - hueKey(b.hex) || byName(a, b));
    return list;
  }, [state.spools, q, sort, aFb.join('|'), aFm.join('|'), aFl.join('|'), aFr, state.settings]);

  const filtered = !!(q.trim() || aFb.length || aFm.length || aFl.length || aFr);
  const filterGroups = [
    brandChips.length ? ['brand', 'Brand', aFb.length] : null,
    matChips.length ? ['material', 'Material', aFm.length] : null,
    locChips.length ? ['place', 'Place', aFl.length] : null,
  ].filter(Boolean);
  const shownGroup = filterGroups.some((g) => g[0] === filterGroup) ? filterGroup : ((filterGroups[0] && filterGroups[0][0]) || 'brand');
  const hasSamples = state.spools.some((s) => s.isSample);
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleBrand = (name) => setFb((cur) => {
    const on = cur.some((b) => sameBrand(b, name));
    const next = cur.filter((b) => !sameBrand(b, name));
    return on ? next : [...next, name];
  });
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const clearFilters = () => { setQ(''); setFb([]); setFm([]); setFl([]); setFr(false); };

  const saveSpool = (f) => {
    ss.set('fs-last-brand', f.brand); ss.set('fs-last-mat', f.material);
    if (f.id) { commit((s) => ({ ...s, spools: s.spools.map((x) => { if (x.id !== f.id) return x; const n = { ...f }; delete n.isSample; return n; }) })); toast('Saved changes'); }
    else { commit((s) => ({ ...s, spools: [...s.spools, { ...f, id: uid() }] })); toast('Added to shelf'); }
    setSheet(null);
  };
  const duplicate = (f) => {
    const seed = { ...f }; delete seed.id; delete seed.isSample; seed.count = 1; seed.remaining = null;
    setSheet({ type: 'edit', spool: null, seed, k: Date.now() });
  };
  const combine = (f, twins) => {
    const extra = twins.reduce((n, s) => n + (s.count || 0), 0);
    const places = twins.map((s) => (s.location || '').trim()).filter((loc) => loc && loc.toLowerCase() !== (f.location || '').trim().toLowerCase());
    setConfirm({
      title: 'Combine ' + f.colorName + '?',
      body: 'This keeps one ' + f.colorName + ' and adds ' + plural(extra, 'spool') + ' from ' + (twins.length === 1 ? 'the other row' : twins.length + ' other rows') + '. Grams left stay with it.' + (places.length ? ' A different place is written into the notes.' : ''),
      action: 'Combine',
      onConfirm: () => {
        const merged = twins.reduce((acc, row) => mergeSpools(acc, row), f);
        const drop = new Set(twins.map((row) => row.id));
        commit((s) => ({ ...s, spools: s.spools.filter((x) => !drop.has(x.id)).map((x) => (x.id === f.id ? merged : x)) }));
        setSheet(null);
        toast('Combined into one color');
      },
    });
  };
  const saveShop = (brand, note, url) => {
    commit((s) => ({ ...s, settings: withShop(s.settings, brand, note, url) }));
    toast(note.trim() || url.trim() ? 'Saved the reorder note' : 'Cleared the reorder note');
  };
  const askDelete = (s) => setConfirm({
    title: 'Delete ' + s.colorName + '?', body: 'This removes ' + s.colorName + ' by ' + s.brand + ' from your shelf. If you have only run out, set the count to 0 instead and it stays on your restock list.',
    action: 'Delete', danger: true, onConfirm: () => {
      commit((st) => ({ ...st, spools: st.spools.filter((x) => x.id !== s.id) })); setSheet(null);
      toast('Deleted ' + s.colorName, { label: 'Undo', run: () => commit((st) => ({ ...st, spools: st.spools.some((x) => x.id === s.id) ? st.spools : [...st.spools, s] })) });
    },
  });
  const clearSamples = () => {
    const gone = state.spools.filter((x) => x.isSample);
    commit((s) => ({ ...s, spools: s.spools.filter((x) => !x.isSample), hideSampleNote: true }));
    toast('Cleared examples', { label: 'Undo', run: () => commit((s) => ({ ...s, spools: [...s.spools, ...gone], hideSampleNote: false })) });
  };
  const setLow = (v) => commit((s) => ({ ...s, settings: { ...s.settings, lowAt: clamp(v, 0, 20) } }));
  const setLowGrams = (v) => commit((s) => ({ ...s, settings: { ...s.settings, lowGrams: clamp(v, 0, 2000) } }));
  const goRestock = () => { clearFilters(); setFr(true); setTab('shelf'); window.scrollTo(0, 0); };

  const status = mode === 'conflict' ? 'Changed on another device' : mode === 'signedout' ? 'Signed out, not saved' : mode === 'rejected' ? 'Couldn’t save that change' : mode === 'offline' && !saving ? 'Not saved yet, retrying' : saving || dirty ? 'Saving…' : mode === 'device' ? 'Saved on this device' : mode === 'viewonly' ? 'View only, saved on this device' : 'Saved';
  const sortLabel = { count: 'Count ↓', countAsc: 'Count ↑' }[sort] || 'Count';

  return (
    <div className="app">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="sp-sheen" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.62" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.22" />
          </linearGradient>
        </defs>
      </svg>

      <div className="bg" ref={bgRef}>
        <header className="top">
          <div className="top-row">
            <h1>Filament <br />Shelf</h1>
            <div className="top-side">
              <button className="icon-btn solid" onClick={() => setSheet({ type: 'more' })} aria-label="Settings, brands and backup">{I.more}</button>
              {mode === 'conflict' || mode === 'signedout' || mode === 'rejected'
                ? <button className="status warn" onClick={() => (mode === 'signedout' ? window.location.reload() : setSheet({ type: 'conflict' }))}>{I.warn}{status}{mode === 'signedout' ? ', sign in' : ''}</button>
                : <span className={'status' + (saving || dirty ? ' busy' : '') + (mode === 'offline' ? ' warn' : '')} role="status"><i />{status}</span>}
            </div>
          </div>
          <dl className="stats">
            <div><dd>{stats.total}</dd><dt>spools</dt></div>
            <div><dd>{stats.colors}</dd><dt>colors</dt></div>
            <div><dd>{stats.brands}</dd><dt>brands</dt></div>
            <div className={stats.out ? 'warn' : ''}><dd>{stats.out}</dd><dt>{stats.out ? <>{I.warn}out</> : 'out'}</dt></div>
          </dl>
        </header>

        {tab === 'shelf' ? (
          <main className="view" key="shelf">
            {hasSamples && !state.hideSampleNote && (
              <div className="banner">
                <p>These are example spools.</p>
                <button className="link-btn" onClick={clearSamples}>Clear examples</button>
                <button className="icon-btn tiny" onClick={() => commit((s) => ({ ...s, hideSampleNote: true }))} aria-label="Hide this note">{I.close}</button>
              </div>
            )}
            {state.spools.length === 0 ? (
              <div className="empty">
                <Spool hex="#888888" count={0} size={132} />
                <h2>Your shelf is empty</h2>
                <p>Add the first spool you can see from where you are standing.</p>
                <button className="btn primary" onClick={() => setSheet({ type: 'edit', spool: null })}>Add a spool</button>
              </div>
            ) : (
              <>
                <div className="controls">
                  <label className="search">
                    {I.search}
                    <span className="sr">Search</span>
                    <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search color, brand or notes" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} />
                    {q ? <button className="icon-btn tiny" onClick={() => setQ('')} aria-label="Clear search">{I.close}</button> : <kbd className="kbd" aria-hidden="true">/</kbd>}
                  </label>
                  <div className="seg-ctl four sort" role="radiogroup" aria-label="Sort by">
                    {[['hue', 'Rainbow'], ['brand', 'Brand'], ['count', sortLabel], ['name', 'A–Z']].map(([k, l]) => {
                      const on = k === 'count' ? sort === 'count' || sort === 'countAsc' : sort === k;
                      return <button key={k} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => setSort(k === 'count' ? (sort === 'count' ? 'countAsc' : 'count') : k)}>{l}</button>;
                    })}
                  </div>
                  <div className="filters">
                    {needN > 0 && (
                      <div className="chips">
                        <button className={'chip warn' + (aFr ? ' on' : '')} aria-pressed={aFr} onClick={() => setFr(!fr)}>{I.warn}Needs restock · {needN}</button>
                      </div>
                    )}
                    {filterGroups.length > 1 && (
                      <div className={'seg-ctl filter-switch' + (filterGroups.length === 2 ? ' two' : '')} role="tablist" aria-label="Filter by">
                        {filterGroups.map(([id, label, n]) => (
                          <button key={id} type="button" role="tab" aria-selected={shownGroup === id} className={shownGroup === id ? 'on' : ''} onClick={() => setFilterGroup(id)}>
                            {label}{n ? ' · ' + n : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {brandChips.length > 0 && (
                      <div className={'filter-row' + (shownGroup === 'brand' ? ' is-on' : '')}>
                        <span className="filter-label" id="filter-brand">Brand</span>
                        <div className="chips" role="group" aria-labelledby="filter-brand">
                          {brandChips.map((b) => <button key={b} className={'chip' + (aFb.some((x) => sameBrand(x, b)) ? ' on' : '')} aria-pressed={aFb.some((x) => sameBrand(x, b))} onClick={() => toggleBrand(b)}>{b}</button>)}
                        </div>
                      </div>
                    )}
                    {matChips.length > 0 && (
                      <div className={'filter-row' + (shownGroup === 'material' ? ' is-on' : '')}>
                        <span className="filter-label" id="filter-material">Material</span>
                        <div className="chips" role="group" aria-labelledby="filter-material">
                          {matChips.map((m) => <button key={m} className={'chip alt' + (aFm.includes(m) ? ' on' : '')} aria-pressed={aFm.includes(m)} onClick={() => toggle(fm, setFm, m)}>{m}</button>)}
                        </div>
                      </div>
                    )}
                    {locChips.length > 0 && (
                      <div className={'filter-row' + (shownGroup === 'place' ? ' is-on' : '')}>
                        <span className="filter-label" id="filter-place">Place</span>
                        <div className="chips" role="group" aria-labelledby="filter-place">
                          {locChips.map((l) => <button key={l} className={'chip loc' + (aFl.includes(l) ? ' on' : '')} aria-pressed={aFl.includes(l)} onClick={() => toggle(fl, setFl, l)}>{I.pin}{l}</button>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {shown.length === 0 ? (
                  <div className="empty slim">
                    <h2>No spools match</h2>
                    <p>Try a shorter search, or clear the filters.</p>
                    <button className="btn ghost" onClick={clearFilters}>Clear search and filters</button>
                  </div>
                ) : (
                  <>
                    {filtered && <p className="count-line">Showing {shown.length} of {plural(state.spools.length, 'color')}</p>}
                    <div className="shelf">
                      {shown.map((s, i) => <Cell_ key={s.id} s={s} i={i} intro={intro} settings={state.settings} onEdit={(sp) => setSheet({ type: 'edit', spool: sp })} onBump={bump} />)}
                    </div>
                  </>
                )}
              </>
            )}
          </main>
        ) : (
          <main className="view" key="insights">
            <Insights state={state} dark={dark} onAdd={() => setSheet({ type: 'edit', spool: null })} onBump={bump} onRestock={goRestock} toast={toast}
              brandsOn={aFb} onToggleBrand={toggleBrand} onClearBrands={() => setFb([])} onSaveShop={saveShop} />
          </main>
        )}

        <nav className="dock" aria-label="Main">
          <button className={tab === 'shelf' ? 'on' : ''} aria-current={tab === 'shelf' ? 'page' : undefined} onClick={() => { setTab('shelf'); window.scrollTo(0, 0); }}>{I.shelf}<span>Shelf</span></button>
          <button className="add" onClick={() => setSheet({ type: 'edit', spool: null })} aria-label="Add a spool" title="Add a spool (N)">{I.plus}</button>
          <button className={tab === 'insights' ? 'on' : ''} aria-current={tab === 'insights' ? 'page' : undefined} onClick={() => { setTab('insights'); window.scrollTo(0, 0); }}>{I.chart}<span>Insights</span></button>
        </nav>
      </div>

      {sheet && sheet.type === 'edit' && (
        <Sheet key={sheet.k || 'edit'} title={sheet.spool ? 'Edit spool' : sheet.seed ? 'Duplicate spool' : 'Add a spool'} onClose={closeSheet} tall>
          <SpoolForm spool={sheet.spool} seed={sheet.seed} brands={state.brands} locations={locChips} others={state.spools} onSave={saveSpool} onDelete={() => askDelete(sheet.spool)} onDuplicate={duplicate} onCombine={combine}
            onAddBrand={(b) => commit((s) => ({ ...s, brands: [...s.brands, b] }))} toast={toast} />
        </Sheet>
      )}
      {sheet && sheet.type === 'more' && (
        <Sheet title="Settings" onClose={closeSheet}>
          <ul className="menu">
            <li><button onClick={() => setSheet({ type: 'brands' })}><div><strong>Manage brands</strong><small>Rename, add or delete. {plural(state.brands.length, 'brand')} so far.</small></div>{I.chev}</button></li>
            <li className="menu-row">
              <div><strong>Low-stock level</strong><small>{lowAt === 0 ? 'Only flag colors that are out.' : 'Flag a color as low at ' + plural(lowAt, 'spool') + ' or fewer.'}</small></div>
              <div className="stepper in-form" role="group" aria-label="Low-stock level">
                <button type="button" onClick={() => setLow(lowAt - 1)} disabled={lowAt <= 0} aria-label="Lower the level">{I.minus}</button>
                <output>{lowAt}</output>
                <button type="button" onClick={() => setLow(lowAt + 1)} aria-label="Raise the level">{I.plus}</button>
              </div>
            </li>
            <li className="menu-row">
              <div><strong>Open-spool warning</strong><small>{lowGrams === 0 ? 'Don’t flag an open spool by weight.' : 'Flag an open spool at ' + lowGrams + ' g or less.'}</small></div>
              <div className="stepper in-form" role="group" aria-label="Open-spool warning">
                <button type="button" onClick={() => setLowGrams(lowGrams - 50)} disabled={lowGrams <= 0} aria-label="Lower the grams">{I.minus}</button>
                <output>{lowGrams === 0 ? 'Off' : lowGrams}</output>
                <button type="button" onClick={() => setLowGrams(lowGrams + 50)} disabled={lowGrams >= 2000} aria-label="Raise the grams">{I.plus}</button>
              </div>
            </li>
            {server() && <li><button onClick={() => setSheet({ type: 'account' })}><div><strong>Account</strong><small>Password and other devices. Signed in as {server().name || server().user}.</small></div>{I.chev}</button></li>}
            <li><button onClick={() => setSheet({ type: 'export' })}><div><strong>Export</strong><small>Copy or save a backup, or a spreadsheet.</small></div>{I.chev}</button></li>
            <li><button onClick={() => setSheet({ type: 'import' })}><div><strong>Import</strong><small>Load a backup or spreadsheet from text or a file.</small></div>{I.chev}</button></li>
          </ul>
          {server() && (
            <div className="menu-row signed">
              <div><strong>Signed in as {server().user}</strong><small>Your shelf is saved on your server.</small></div>
              <button className="btn ghost small" onClick={signOut}>Sign out</button>
            </div>
          )}
          <p className="fine">{server() ? 'Changes save a moment after you stop tapping.' : mode === 'viewonly' ? 'You are viewing a shared copy. Changes stay on this device.' : mode === 'device' ? 'Changes are kept on this device. Export a backup now and then.' : 'Changes save a moment after you stop tapping.'}</p>
          <p className="fine">Color catalog from the <a href="https://github.com/OpenFilamentCollective/open-filament-database" target="_blank" rel="noopener noreferrer">Open Filament Database</a> (MIT license).</p>
          <p className="fine kbd-help">Shortcuts: <kbd className="kbd">/</kbd> search, <kbd className="kbd">N</kbd> new spool, <kbd className="kbd">1</kbd> <kbd className="kbd">2</kbd> switch tabs, <kbd className="kbd">Esc</kbd> close.</p>
        </Sheet>
      )}
      {sheet && sheet.type === 'account' && <Sheet title="Account" onClose={closeSheet}><AccountSheet toast={toast} /></Sheet>}
      {sheet && sheet.type === 'brands' && <Sheet title="Manage brands" onClose={closeSheet} tall><BrandsManager state={state} commit={commit} toast={toast} /></Sheet>}
      {sheet && sheet.type === 'export' && <Sheet title="Export" onClose={closeSheet}><ExportSheet state={state} toast={toast} /></Sheet>}
      {sheet && sheet.type === 'import' && <Sheet title="Import" onClose={closeSheet}><ImportSheet state={state} commit={commit} toast={toast} onDone={closeSheet} /></Sheet>}
      {sheet && sheet.type === 'conflict' && (
        <Sheet title={mode === 'rejected' ? 'Couldn’t save' : 'Changed on another device'} onClose={closeSheet}>
          <p className="lead">{mode === 'rejected'
            ? 'The server refused your latest change, usually because something is too long or the shelf is over its size limit. Load the saved shelf to continue, or export your version first.'
            : 'Someone saved this shelf from another device after you last loaded it. Keep your version to replace theirs, or load theirs and lose your last change.'}</p>
          <div className="choice">
            {mode !== 'rejected' && <button className="choice-btn" onClick={keepMine}><strong>Keep my version</strong><small>Saves what you see now over the other change.</small></button>}
            <button className="choice-btn danger" onClick={loadLatest}><strong>Load the saved shelf</strong><small>Your unsaved change is dropped.</small></button>
          </div>
          <button className="btn ghost full" onClick={() => setSheet({ type: 'export' })}>Export my version first</button>
        </Sheet>
      )}
      {confirm && <Confirm c={confirm} onClose={closeConfirm} />}
      {toastMsg && (
        <div className={'toast' + (toastMsg.action ? ' has-action' : '')} key={toastMsg.k} role="status" style={toastMsg.action ? { animationDuration: '6s' } : undefined}>
          <span>{toastMsg.t}</span>
          {toastMsg.action && <button onClick={() => { toastMsg.action.run(); setToastMsg(null); }}>{toastMsg.action.label}</button>}
        </div>
      )}
    </div>
  );
}
