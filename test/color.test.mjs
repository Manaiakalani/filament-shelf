import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hueKey, isRainbow, RAINBOW_HEX } from '../app/src/color.js';

test('rainbow is its own selectable color and sorts after real hues', () => {
  assert.equal(isRainbow(RAINBOW_HEX), true);
  assert.equal(isRainbow('#ff2bd6'), true);
  assert.equal(isRainbow('#D63A2F'), false);
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#D63A2F'));
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#2456C9'));
  assert.ok(hueKey(RAINBOW_HEX) > hueKey('#F4F3EE'));
});
