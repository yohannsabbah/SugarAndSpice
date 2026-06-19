import Papa from 'papaparse'
import { stripBom, parseHourLabel, toNumber } from './text-utils.js'

// Nayax "hourly sales" CSV — one row per hour 00:00..23:00, plus a grand-total
// row at the bottom. Columns are positional (TextBox4..TextBox12); see the
// example at data/nayax/2026/05/hourly.csv.
//
// Returns:
//   { hours: [{ hour, revenue, orders, avg_ticket }, …],   // up to 24 entries
//     grand_total_revenue: number | null }
export function parseHourly(csvText) {
  const { data } = Papa.parse(csvText, { header: false, skipEmptyLines: true })
  if (!data.length) return { hours: [], grand_total_revenue: null }

  // First row is the header — skip it.
  const rows = data.slice(1)
  const hours = []
  let grand_total_revenue = null

  for (const row of rows) {
    // Defensive: papaparse gives us arrays of strings.
    const c0 = stripBom(row[0] ?? '')
    const hour = parseHourLabel(c0)
    if (hour != null) {
      const revenue = toNumber(row[1]) ?? 0
      const orders = toNumber(row[2]) ?? 0
      const avg_ticket = toNumber(row[3])
      hours.push({ hour, revenue, orders, avg_ticket })
    } else if (!c0 && toNumber(row[4]) != null) {
      // Grand-total row: hour cells empty, total revenue in col TextBox10 (index 4).
      grand_total_revenue = toNumber(row[4])
    }
  }

  return { hours, grand_total_revenue }
}
