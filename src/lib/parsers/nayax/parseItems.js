import Papa from 'papaparse'
import { fixMojibake, stripBom, toNumber } from './text-utils.js'

// Nayax "items by category" monthly CSV. Structure:
//
//   Store,Category,SKU,ItemName,AvgPrice,Revenue,Units,Share, …subtotals + grand totals…
//   "1 sugar & spice","0 רשת מערכת","1000","פרסום מוצר","19.41","2058","106","0.06",…
//   "",            "",            "100009","Cute Cat ",  "24",   "240", "10","0.007",…
//   …more items in same category…
//   "","","","","","","","","143.41","2531","133","0.075",…  ← category subtotal (skip)
//   "","1 🥤 Cold Drinks","100000","Cola Fanta Sprite",…       ← new category starts
//
// The category in col[1] is sticky: once set, it applies to all subsequent
// item rows until a new col[1] value appears.
//
// Returns:
//   { items: [{ merchant_sku, item_name, raw_category, avg_price_incl_vat,
//               revenue_incl_vat, units_sold, share_of_total }, …],
//     grand_total: { revenue_incl_vat, units_sold } | null }
export function parseItems(csvText) {
  const { data } = Papa.parse(csvText, { header: false, skipEmptyLines: true })
  if (!data.length) return { items: [], grand_total: null }

  // Skip the header row.
  const rows = data.slice(1)
  const items = []
  let currentCategory = null
  let grand_total = null

  for (const rawRow of rows) {
    const row = rawRow.map((c, i) => (i === 0 ? stripBom(c ?? '') : c ?? '')).map(fixMojibake)

    // Update sticky category from col[1] if present.
    const categoryCell = (row[1] ?? '').trim()
    if (categoryCell) currentCategory = categoryCell

    const sku   = (row[2] ?? '').trim()
    const name  = (row[3] ?? '').trim()
    const avgP  = toNumber(row[4])
    const rev   = toNumber(row[5])
    const units = toNumber(row[6])
    const share = toNumber(row[7])

    if (sku && name && rev != null && units != null) {
      items.push({
        merchant_sku: sku,
        item_name: name,
        raw_category: currentCategory,
        avg_price_incl_vat: avgP,
        revenue_incl_vat: rev,
        units_sold: units,
        share_of_total: share,
      })
      continue
    }

    // Grand-total rows: no item, but a numeric in col 13 (penultimate row,
    // "1736.17 / 33625.2 / 1600 / 1") or col 16 (final row, "33625.2 / 1600 / 1")
    // with earlier cells empty. Take whichever row appears last.
    if (!sku && !name) {
      const r13 = toNumber(row[13])
      const u14 = toNumber(row[14])
      const r16 = toNumber(row[16])
      const u17 = toNumber(row[17])
      if (r13 != null && u14 != null) grand_total = { revenue_incl_vat: r13, units_sold: u14 }
      if (r16 != null && u17 != null) grand_total = { revenue_incl_vat: r16, units_sold: u17 }
    }
  }

  return { items, grand_total }
}
