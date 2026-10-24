// Month totals grouped for the pie charts on /admin/receipts. Pure, for the
// verify scripts. Duplicates and rows without an amount are left out.

function round2(n) {
  return Math.round(n * 100) / 100
}

// Returns [{ key, total }], largest first. Past `limit` slices, the rest fold
// into one { key: null, total, other: true } slice at the end.
export function breakdown(rows, keyOf, limit = 7) {
  const sums = new Map()
  for (const r of rows) {
    if (r.duplicate_of || r.total === null || r.total === undefined) continue
    const key = keyOf(r) || null
    sums.set(key, (sums.get(key) || 0) + Number(r.total))
  }
  const slices = [...sums.entries()]
    .map(([key, total]) => ({ key, total: round2(total) }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
  if (slices.length <= limit + 1) return slices
  const rest = slices.slice(limit)
  return [...slices.slice(0, limit), { key: null, total: round2(rest.reduce((s, x) => s + x.total, 0)), other: true }]
}

// One spelling per vendor: the model can return the same shop with different
// spacing on two receipts.
export function vendorKey(r) {
  return r.vendor ? r.vendor.replace(/\s+/g, ' ').trim() : null
}
