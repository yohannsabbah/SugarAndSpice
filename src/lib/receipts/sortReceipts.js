// Table order for /admin/receipts. Pure, for the verify scripts.

// A parsed row the model was unsure about, or left without a total or a date.
// Once the owner edits a row it is reviewed and never needs a check again.
export function needsCheck(r) {
  return r.parse_status === 'parsed' && (r.ai_confidence === 'low' || r.total === null || r.total === undefined || !r.purchased_at)
}

function rank(r) {
  if (r.parse_status === 'error') return 0
  if (r.parse_status === 'pending') return 1
  return needsCheck(r) ? 2 : 3
}

// Rows that need the owner come first: errors, not yet read, then unsure
// reads. The rest follow by purchase date.
export function sortReceipts(rows) {
  return [...rows].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return (a.purchased_at || a.uploaded_at).localeCompare(b.purchased_at || b.uploaded_at)
  })
}
