import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gramsOnHand, needsRestock, normalize, parseCsv, spoolValue, toCsv } from '../app/src/store.js';
import { precheck } from '../server/shelf.mjs';

const color = (extra) => ({ id: 's1', brand: 'Elegoo', material: 'PLA', colorName: 'Red', hex: '#ff0000', count: 2, weight: 1000, ...extra });

test('an older shelf without grams left still counts full spools', () => {
  const state = normalize({ spools: [color()], settings: { lowAt: 1 } });
  assert.equal(state.spools[0].remaining, undefined);
  assert.equal(state.settings.lowGrams, 200);
  assert.equal(gramsOnHand(state.spools[0]), 2000);
  assert.equal(needsRestock(state.spools[0], state.settings), false);
});

test('grams left apply to the open spool and feed the restock list', () => {
  const state = normalize({ spools: [color({ remaining: 5000, count: 2, price: 20 })], settings: { lowAt: 1, lowGrams: 200 } });
  assert.equal(state.spools[0].remaining, 1000);
  assert.equal(gramsOnHand(state.spools[0]), 2000);
  const open = normalize({ spools: [color({ count: 3, remaining: 80, price: 10 })], settings: { lowAt: 1, lowGrams: 200 } });
  assert.equal(gramsOnHand(open.spools[0]), 2080);
  assert.equal(needsRestock(open.spools[0], open.settings), true);
  assert.ok(Math.abs(spoolValue(open.spools[0]) - 20.8) < 0.001);
  const empty = normalize({ spools: [color({ count: 0, remaining: 40 })] });
  assert.equal(empty.spools[0].remaining, undefined);
  assert.equal(gramsOnHand(empty.spools[0]), 0);
  assert.equal(needsRestock(empty.spools[0], empty.settings), true);
});

test('a spreadsheet round-trips grams left and still accepts the older columns', () => {
  const state = normalize({
    brands: ['Elegoo'],
    spools: [color({ remaining: 180, location: 'Drybox', notes: 'nozzle 210' })],
    settings: { lowAt: 1, lowGrams: 150 },
  });
  const again = parseCsv(toCsv(state));
  assert.equal(again.spools[0].remaining, 180);
  assert.equal(again.spools[0].location, 'Drybox');
  assert.equal(again.spools[0].weight, 1000);
  const legacy = parseCsv('Brand,Material,Color,Hex,Spools,Location,Price,Spool size (g),Notes\nElegoo,PLA,Red,#ff0000,1,Shelf,12,750,plain\n');
  assert.equal(legacy.spools[0].weight, 750);
  assert.equal(legacy.spools[0].remaining, undefined);
  assert.equal(legacy.spools[0].price, 12);
});

test('a huge shelf is refused before the full check', () => {
  assert.throws(() => precheck({ spools: Array.from({ length: 5001 }, () => ({})) }), /Too many spools/);
  assert.throws(() => precheck({ brands: [] }), /no "spools"/);
});
