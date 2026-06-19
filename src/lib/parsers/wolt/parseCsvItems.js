import Papa from 'papaparse'

// The Wolt portal CSV exports arrive UTF-8-encoded but with the byte stream
// already misinterpreted somewhere upstream — Hebrew shows up as mojibake when
// read as UTF-8 (e.g. "×¢××ª" instead of "עוגת"). The fix is to
// re-decode the bytes as latin1 → utf-8.
export function fixHebrewMojibake(s) {
  if (s == null) return s
  // If we already have valid Hebrew chars, do nothing.
  if (/[֐-׿]/.test(s)) return s
  try {
    const bytes = new Uint8Array([...s].map((c) => c.charCodeAt(0)))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return s
  }
}

export function parseCsvItems(csvText, { monthStart }) {
  // monthStart is a YYYY-MM-DD string we attach to every row, since the items
  // CSV is whole-month aggregate, not per-period.
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  return data
    .map((row) => ({
      month_start: monthStart,
      merchant_sku: row['Merchant SKU']?.trim() || null,
      item_name: fixHebrewMojibake(row['Item name'] || '').trim(),
      units_sold: Number(row['Quantity']) || 0,
      revenue_incl_vat: Number(row['Total']) || 0,
    }))
    .filter((r) => r.item_name && r.units_sold > 0)
}
