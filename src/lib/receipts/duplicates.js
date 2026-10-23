// The owner's rule: one paper receipt has one date, one amount, and one time
// or receipt number. Two photos of it are duplicates. Without a time or a
// number to compare, two equal purchases on one day are real, never flagged.

function same(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a).trim() === String(b).trim()
}

export function findDuplicateOf(receipt, candidates) {
  const match = candidates.find(
    (c) =>
      c.id !== receipt.id &&
      c.purchased_at === receipt.purchased_at &&
      Number(c.total) === Number(receipt.total) &&
      (same(c.purchased_time, receipt.purchased_time) || same(c.receipt_number, receipt.receipt_number)),
  )
  return match ? match.id : null
}
