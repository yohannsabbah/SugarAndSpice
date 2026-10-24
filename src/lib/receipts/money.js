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

// What the owner checks against the accountant. Duplicates are left out.
export function summarizeReceipts(rows) {
  const counted = rows.filter((r) => !r.duplicate_of)
  return {
    count: counted.length,
    total: round2(counted.reduce((s, r) => s + Number(r.total || 0), 0)),
    vat: round2(counted.reduce((s, r) => s + Number(r.vat_amount || 0), 0)),
  }
}
