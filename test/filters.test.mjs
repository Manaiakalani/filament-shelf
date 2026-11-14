import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeNames, brandsInUse, sameBrand } from '../app/src/filters.js';

test('brands in use prefer the managed spelling and the fullest company', () => {
  const brands = brandsInUse(
    ['Elegoo', 'Sunlu'],
    [
      { brand: 'sunlu', count: 1 },
      { brand: 'Sunlu', count: 4 },
      { brand: 'Make Market', count: 2 },
      { brand: 'Elegoo', count: 0 },
      { brand: '  ', count: 3 },
    ],
  );
  assert.deepEqual(brands, ['Sunlu', 'Make Market', 'Elegoo']);
  assert.equal(sameBrand(' Sunlu ', 'sunlu'), true);
  assert.deepEqual(activeNames(['sunlu', 'Sunlu', 'Gone'], brands), ['Sunlu']);
});
