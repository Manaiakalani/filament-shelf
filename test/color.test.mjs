import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hueKey, isRainbow, RAINBOW_HEX, hexFromName, hexMatchesName, spoolFinish } from '../app/src/color.js';

test('rainbow is its own selectable color and sorts after real hues', () => {
  assert.equal(isRainbow(RAINBOW_HEX), true);
  assert.equal(isRainbow('#ff2bd6'), true);
  assert.equal(isRainbow('#D63A2F'), false);
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#D63A2F'));
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#2456C9'));
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#F4F3EE'));
});

test('a color name picks a keyword color and leaves a matching shade alone', () => {
  assert.equal(hexFromName('Silk Rainbow'), RAINBOW_HEX);
  assert.equal(hexFromName('Light Blue Glitter'), hexFromName('Light Blue'));
  assert.equal(hexFromName('Blue Whale Grey'), '#4E6481');
  assert.equal(hexFromName('Prototype'), null);
  assert.equal(hexMatchesName('Cherry Red', '#FE5953'), true);
  assert.equal(hexMatchesName('Olive Green', '#808000'), true);
  assert.equal(hexMatchesName('Olive Green', '#97A014'), true);
  assert.equal(hexMatchesName('Black', '#1E1F24'), true);
  assert.equal(hexMatchesName('Black', '#000000'), true);
  assert.equal(hexMatchesName('Grey', '#4F5656'), true);
  assert.equal(hexMatchesName('Beige', '#E7EFD7'), false);
  assert.equal(hexMatchesName('White Speckle', '#C7CCD1'), false);
  assert.equal(hexMatchesName('Light Pink Glitter', '#B7729C'), false);
  assert.equal(hexMatchesName('Light Blue', '#99FFFA'), false);
  assert.equal(hexMatchesName('Baby Pink', '#FFE0E0'), false);
  assert.equal(hexFromName('Beige'), '#E4CFA0');
  assert.notEqual(hexFromName('Light Green'), hexFromName('Green'));
});

test('glitter and speckle are finishes, and silk in the name still counts', () => {
  assert.deepEqual(spoolFinish('PLA', 'White Speckle'), { silk: false, glitter: false, speckle: true });
  assert.deepEqual(spoolFinish('PLA', 'Light Pink Glitter'), { silk: false, glitter: true, speckle: false });
  assert.equal(spoolFinish('PLA', 'Silk Rainbow').silk, true);
  assert.equal(spoolFinish('Silk PLA', 'Red').silk, true);
  assert.equal(spoolFinish('Matte PLA', 'Beige').silk, false);
});
