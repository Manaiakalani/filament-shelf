export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const validHex = (h) => /^#[0-9a-f]{6}$/i.test(h);
// Stored like any other color so backups and spreadsheets keep it. Nothing in the
// catalog uses this hex. The shelf draws it as a spectrum, not as this pink.
export const RAINBOW_HEX = '#FF2BD6';
export const isRainbow = (hex) => String(hex || '').trim().toUpperCase() === RAINBOW_HEX;
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
export function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const { h } = hexToHsv(hex);
  return { h, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
}
// Ink is for the tag text in light mode. Fill is the dot and the wash, and it
// stays bright enough for the material chart. The four types on the live shelf
// sit far apart: PLA green, Matte PLA gold, PLA+ orange, PETG blue.
const MATERIAL_TONES = [
  ['pla', '#1F9D5A', '#0E6B3C'],
  ['matte pla', '#C4962A', '#7A5E10'],
  ['pla+', '#E06A2F', '#A34112'],
  ['silk pla', '#D4539A', '#9A2E6E'],
  ['pla-cf', '#5E7A62', '#3A4C3C'],
  ['petg', '#3B6FE0', '#1E46A8'],
  ['petg-cf', '#5B4BC4', '#3A2E8C'],
  ['tpu', '#8B5CF6', '#5B32B0'],
  ['abs', '#E24B4B', '#A82424'],
  ['asa', '#D97706', '#8A4E04'],
  ['nylon', '#C47A4A', '#8A4E28'],
  ['pc', '#6E7C90', '#3E4A5C'],
  ['pvb', '#14B8A6', '#0F766E'],
];
const MATERIAL_TONE = new Map(MATERIAL_TONES.map(([name, fill, ink]) => [name, { fill, ink }]));
const SPARE_TONES = [
  { fill: '#0F766E', ink: '#0F5550' },
  { fill: '#BE3A6A', ink: '#8A2348' },
  { fill: '#3F6F8C', ink: '#2A4C61' },
  { fill: '#A16207', ink: '#713F06' },
];

export function materialTone(name) {
  const key = String(name || '').trim().toLowerCase();
  const known = MATERIAL_TONE.get(key);
  if (known) return known;
  if (!key) return { fill: '#8B90A0', ink: '#525A6E' };
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return SPARE_TONES[h % SPARE_TONES.length];
}

// Silk, glitter, and speckle are finishes in the name or the material, not separate colors.
export function spoolFinish(material, colorName) {
  const text = String(material || '') + ' ' + String(colorName || '');
  return {
    silk: /silk/i.test(text),
    glitter: /glitter|sparkle/i.test(text),
    speckle: /speckle/i.test(text),
  };
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Longer phrases first so "light blue" wins over "blue" and "blue whale" wins over "grey".
// Finish words (matte, silk, glitter, speckle) are ignored because they are not colors.
const NAME_COLORS = [
  ['rainbow', RAINBOW_HEX],
  ['blue whale', '#4E6481'],
  ['navy', '#1E2A5A'],
  ['sky blue', '#3A9FE0'],
  ['light blue', '#7EC8F0'],
  ['baby blue', '#A9D4F5'],
  ['digital blue', '#0066D9'],
  ['azure', '#0066D9'],
  ['aqua', '#5EBDDB'],
  ['turquoise', '#3DB8C4'],
  ['teal', '#1A9E9A'],
  ['mint', '#7FCB9A'],
  ['olive', '#8C8F22'],
  ['apple green', '#84D18B'],
  ['light green', '#A8D5B5'],
  ['lime', '#9BCB3C'],
  ['lemon', '#E8E06A'],
  ['baby pink', '#F6C6CE'],
  ['light pink', '#F5A3C0'],
  ['pastel red', '#F0999C'],
  ['cherry', '#E24B4B'],
  ['chocolate', '#57361C'],
  ['burgundy', '#7A2E36'],
  ['maroon', '#7A2E36'],
  ['brown', '#7B4B2A'],
  ['beige', '#E4CFA0'],
  ['cream', '#EED1A8'],
  ['bone', '#E9E1CF'],
  ['oak', '#C7955A'],
  ['tan', '#C4A06A'],
  ['gold', '#C9A227'],
  ['copper', '#B5663A'],
  ['silver', '#C5CCD2'],
  ['lavender', '#B7A4DE'],
  ['magenta', '#D43F9A'],
  ['violet', '#7A45C4'],
  ['purple', '#7A45C4'],
  ['pink', '#F08AB0'],
  ['green', '#1FA85A'],
  ['yellow', '#F6C416'],
  ['orange', '#F27A2E'],
  ['red', '#D63A2F'],
  ['blue', '#2E6FE0'],
  ['grey', '#8A9098'],
  ['gray', '#8A9098'],
  ['white', '#F7F6F2'],
  ['black', '#1C1D21'],
];

function nameHas(name, phrase) {
  return new RegExp('(?:^|[^a-z])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[^a-z]|$)', 'i').test(name);
}

// The hex a color name should read as, or null when the name has no color word.
export function hexFromName(name) {
  const text = String(name || '');
  for (const [phrase, hex] of NAME_COLORS) {
    if (nameHas(text, phrase)) return hex;
  }
  return null;
}

function hueDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// Black stays black even with a little chroma. White is only the near-paper end of grey.
function tone(hex) {
  const c = hexToHsv(hex);
  if (c.v <= 0.22) return { kind: 'black', ...c };
  if (c.s < 0.16 && c.v >= 0.9) return { kind: 'white', ...c };
  if (c.s < 0.16) return { kind: 'grey', ...c };
  return { kind: 'color', ...c };
}

// True when the stored hex already reads as the name, so a real catalog shade can stay.
// A name with no color word also matches: there is nothing to correct.
export function hexMatchesName(name, hex) {
  const want = hexFromName(name);
  if (!want || !validHex(String(hex || ''))) return true;
  const got = String(hex).toUpperCase();
  if (isRainbow(want) || isRainbow(got)) return isRainbow(want) && isRainbow(got);
  const A = tone(want);
  const B = tone(got);
  if (A.kind !== 'color' || B.kind !== 'color') return A.kind === B.kind;
  if (hueDist(A.h, B.h) > 20) return false;
  const text = String(name || '');
  const lightName = nameHas(text, 'light') || nameHas(text, 'pale') || nameHas(text, 'pastel') || nameHas(text, 'baby');
  if (lightName && luminance(got) < 0.4) return false;
  if ((nameHas(text, 'dark') || nameHas(text, 'deep') || nameHas(text, 'navy')) && B.v > 0.62) return false;
  return true;
}

// Rainbow order: neutrals first (light to dark), then by hue starting at red.
export function hueKey(hex) {
  if (isRainbow(hex)) return 400;
  const { h, s, v } = hexToHsv(hex);
  if (s < 0.14 || v < 0.22) return -1 + (1 - v);
  return 10 + ((h + 15) % 360);
}
