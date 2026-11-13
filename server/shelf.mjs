// Shelf limits and checks, shared by the server and the restore tool.
export const LIMITS = { spools: 5000, brands: 500, str: { brand: 80, material: 40, colorName: 120, notes: 2000, location: 40, id: 64 } };

// Cheap size checks before the full validation, so a huge save can't tie up the server.
export function precheck(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spools)) throw new Error('The shelf has no "spools" list.');
  if (raw.spools.length > LIMITS.spools) throw new Error('Too many spools (the limit is ' + LIMITS.spools + ').');
  if (Array.isArray(raw.brands) && raw.brands.length > LIMITS.brands) throw new Error('Too many brands (the limit is ' + LIMITS.brands + ').');
  return raw;
}

export function cap(state) {
  if (state.spools.length > LIMITS.spools) throw new Error('Too many spools');
  if (state.brands.length > LIMITS.brands) throw new Error('Too many brands');
  const S = LIMITS.str;
  state.brands = state.brands.map((b) => b.slice(0, S.brand));
  state.spools = state.spools.map((s) => ({ ...s, id: s.id.slice(0, S.id), brand: s.brand.slice(0, S.brand), material: s.material.slice(0, S.material),
    colorName: s.colorName.slice(0, S.colorName), notes: s.notes.slice(0, S.notes), location: (s.location || '').slice(0, S.location) }));
  return state;
}

// Accepts a saved shelf {rev, state}, a file from backups/, or a bare app export {version, brands, spools}.
export function toShelf(raw, normalize) {
  const wrapped = raw && typeof raw === 'object' && raw.state && typeof raw.state === 'object' && !Array.isArray(raw.spools);
  const state = cap(normalize(precheck(wrapped ? raw.state : raw)));
  return { rev: wrapped && Number.isInteger(raw.rev) && raw.rev > 0 ? raw.rev : 1, state };
}
