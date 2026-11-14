// Brand names the shelf can filter on. Managed spelling wins when a spool
// differs only by case. Order is most spools first, then name.
export function sameBrand(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function brandsInUse(brands, spools) {
  const counts = new Map();
  for (const s of spools || []) {
    const raw = String(s.brand || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const n = Number(s.count) || 0;
    const cur = counts.get(key);
    if (cur) { cur.rows += 1; cur.spools += n; }
    else counts.set(key, { name: raw, rows: 1, spools: n });
  }
  for (const b of brands || []) {
    const name = String(b || '').trim();
    const cur = name && counts.get(name.toLowerCase());
    if (cur) cur.name = name;
  }
  return [...counts.values()]
    .sort((a, b) => b.spools - a.spools || b.rows - a.rows || a.name.localeCompare(b.name))
    .map((x) => x.name);
}

// Keep a saved selection only when that name is still on the shelf, and use the
// spelling the chip shows so a toggle cannot get stuck on a second casing.
export function activeNames(selected, options) {
  const out = [];
  for (const s of selected || []) {
    const hit = (options || []).find((o) => sameBrand(o, s));
    if (hit && !out.some((o) => sameBrand(o, hit))) out.push(hit);
  }
  return out;
}
