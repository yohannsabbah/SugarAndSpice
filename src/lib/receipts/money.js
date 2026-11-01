// VAT and totals for receipts. Israeli receipt totals include VAT, so VAT is
// taken out of the total rather than added to it. Pure, for the verify scripts.

export const VAT_RATE = 0.18

function round2(n) {
  return Math.round(n * 100) / 100
}

export function vatAmount(total, rate = VAT_RATE) {
  if (total === null || total === undefined) return null
  return round2((Number(total) * rate) / (1 + rate))
}

export function netAmount(total, vat) {
  if (total === null || total === undefined || vat === null || vat === undefined) return null
  return round2(Number(total) - Number(vat))
}

// What the owner checks against the accountant. Duplicates and receipts for
// home are left out: they are not business expenses.
export function summarizeReceipts(rows) {
  const counted = rows.filter((r) => !r.duplicate_of && !r.for_home)
  return {
    count: counted.length,
    total: round2(counted.reduce((s, r) => s + Number(r.total || 0), 0)),
    vat: round2(counted.reduce((s, r) => s + Number(r.vat_amount || 0), 0)),
  }
}

// Receipts for the owner's home (duplicates left out). They are exported for
// the accountant but are not part of the expenses.
export function summarizeHome(rows) {
  const home = rows.filter((r) => !r.duplicate_of && r.for_home)
  return { count: home.length, total: round2(home.reduce((s, r) => s + Number(r.total || 0), 0)) }
}
