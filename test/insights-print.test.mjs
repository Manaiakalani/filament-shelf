import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insightsSheetHtml } from '../app/src/insights-print.js';
import { RAINBOW_HEX } from '../app/src/color.js';

const when = new Date('2026-11-27T20:00:00Z');

test('the insights sheet names the shelf, the colors, and an empty roll', () => {
  const html = insightsSheetHtml({
    spools: [
      { brand: 'Bambu Lab', material: 'PLA', colorName: 'Jade White', hex: '#FFFFFF', count: 2, weight: 1000, price: 20 },
      { brand: 'Elegoo', material: 'Matte PLA', colorName: 'Navy Blue', hex: '#2D3F6F', count: 1, weight: 1000 },
      { brand: 'Bambu Lab', material: 'PLA', colorName: 'Sky Blue', hex: '#56B7E6', count: 0, weight: 1000 },
      { brand: 'Bambu Lab', material: 'PLA', colorName: 'Rainbow', hex: RAINBOW_HEX, count: 1, weight: 1000 },
    ],
    brands: ['Bambu Lab', 'Elegoo'],
    ownerName: 'Max',
    brandFilter: ['Bambu Lab'],
    when,
  });
  const date = when.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  assert.match(html, /Max&#39;s shelf/);
  assert.ok(html.includes(date));
  assert.match(html, /Only Bambu Lab\./);
  assert.match(html, /<b>3<\/b><span>colors<\/span>/);
  assert.match(html, /<b>3<\/b><span>spools<\/span>/);
  assert.match(html, /3\.0 kg/);
  assert.match(html, /Jade White/);
  assert.match(html, /Sky Blue/);
  assert.match(html, />Out</);
  assert.doesNotMatch(html, /Navy Blue/);
  assert.doesNotMatch(html, /Elegoo/);
  assert.match(html, /class="p-rain"/);
  assert.match(html, /data-bg="#ff3b30"/);
  assert.match(html, /data-bg="#bf5af2"/);
  assert.doesNotMatch(html, /conic-gradient/);
  assert.match(html, /data-grow="2"/);
  assert.match(html, /class="p-strand"/);
  assert.match(html, /class="p-meter"/);
  assert.doesNotMatch(html, /<style/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /\sstyle="/);
});

test('the sheet links its stylesheet and keeps a bad address inside the attribute', () => {
  const html = insightsSheetHtml({
    spools: [],
    brands: [],
    ownerName: 'Max',
    cssHref: 'https://filament.example/assets/paper-abc.css" onload="alert(1)',
    when,
  });
  assert.match(html, /class="p-quiet"/);
  assert.doesNotMatch(html, /class="quiet"/);
  assert.match(html, /No spools on hand to split by material/);
  assert.match(html, /href="https:\/\/filament\.example\/assets\/paper-abc\.css&quot; onload=&quot;alert\(1\)"/);
  assert.doesNotMatch(html, /<link[^>]*\sonload="/);
  assert.doesNotMatch(html, /<script/);
});

test('a color name cannot break out of the sheet', () => {
  const html = insightsSheetHtml({
    spools: [{ brand: 'A<b>', material: 'PLA', colorName: 'Red & Blue', hex: '#ff0000', count: 1, weight: 1000 }],
    brands: [],
    ownerName: 'A<b>',
    when,
  });
  assert.match(html, /A&lt;b&gt;/);
  assert.match(html, /Red &amp; Blue/);
  assert.doesNotMatch(html, /A<b>/);
});
