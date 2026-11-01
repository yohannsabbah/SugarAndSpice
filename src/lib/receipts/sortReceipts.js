// Table order for /admin/expenses. Pure, for the verify scripts.

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
// reads. Inside each group the latest comes first: by purchase date (the
// upload date when there is none), then time, then upload.
export function sortReceipts(rows) {
  return [...rows].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    const day = (r) => r.purchased_at || r.uploaded_at.slice(0, 10)
    return (
      day(b).localeCompare(day(a)) ||
      (b.purchased_time || '').localeCompare(a.purchased_time || '') ||
      b.uploaded_at.localeCompare(a.uploaded_at)
    )
  })
}
