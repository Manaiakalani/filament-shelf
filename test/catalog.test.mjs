import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('../app/src/catalog.json', import.meta.url), 'utf8'));

function line(brand, name) {
  const b = catalog.brands.find((row) => row.b === brand);
  assert.ok(b, brand);
  const found = b.l.find((row) => row.f === name);
  assert.ok(found, brand + ' ' + name);
  return found;
}

test('Bambu PLA Matte includes Nardo Gray and Sky Blue', () => {
  const matte = line('Bambu Lab', 'PLA Matte');
  const colors = Object.fromEntries(matte.c);
  assert.equal(colors['Nardo Gray'], '757575');
  assert.equal(colors['Sky Blue'], '56B7E6');
  assert.equal(colors['Nardo Grey'], undefined);
  assert.equal(matte.m, 'PLA');
});

test('later Bambu lines are in the catalog', () => {
  assert.equal(line('Bambu Lab', 'PLA Basic Gradient').c.length, 8);
  assert.equal(line('Bambu Lab', 'PLA Silk').c.length, 8);
  assert.equal(line('Bambu Lab', 'PLA Silk Dual Color').c.length, 10);
  assert.equal(line('Bambu Lab', 'PLA Tough').c.length, 10);
  assert.deepEqual(line('Bambu Lab', 'Support for PLA').c, [['White', 'FFFFFF']]);
  assert.equal(line('Bambu Lab', 'TPU 95A').m, 'TPU');
});
