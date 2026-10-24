// The owner's rule: one paper receipt has one date, one amount, and one time
// or receipt number. Two photos of it are duplicates. Without a time or a
// number to compare, two equal purchases on one day are real, never flagged.

function same(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a).trim() === String(b).trim()
}

function sameReceipt(a, b) {
  return (
    a.id !== b.id &&
    a.purchased_at === b.purchased_at &&
    Number(a.total) === Number(b.total) &&
    (same(a.purchased_time, b.purchased_time) || same(a.receipt_number, b.receipt_number))
  )
}

// The original is the earliest upload (ties: lowest id), whichever row is read
// first. So two reads that run at the same time agree, and the row read last
// still sees the other. Returns what the receipt being read points at, and the
// later rows that must point at it. A row the owner reviewed is never re-marked.
export function duplicatePlan(receipt, candidates) {
  const matches = candidates.filter((c) => sameReceipt(c, receipt))
  if (matches.length === 0) return { duplicateOf: null, copies: [] }
  const byUpload = (a, b) => (a.uploaded_at === b.uploaded_at ? (a.id < b.id ? -1 : 1) : a.uploaded_at < b.uploaded_at ? -1 : 1)
  const original = [receipt, ...matches].sort(byUpload)[0]
  if (original !== receipt) return { duplicateOf: original.duplicate_of || original.id, copies: [] }
  const copies = matches.filter((c) => c.parse_status !== 'reviewed' && c.duplicate_of !== receipt.id).map((c) => c.id)
  return { duplicateOf: null, copies }
}
