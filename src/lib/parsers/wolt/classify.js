import {
  parseWoltToMerchant,
  parseMerchantToWolt,
  parseNetting,
  parseSalesReport,
} from './index.js'
import Papa from 'papaparse'

// Pure decision logic — given the four PDF parsers' already-computed
// outputs, decide which one this file actually is. Order matters: netting
// and sales-report signals are the most specific and are checked first to
// avoid false positives against the two invoice types, which share a
// similar header structure (invoice date / invoice no / period line).
export function classifyParsedPdf({ netting, sales, m2w, w2m }) {
  if (netting.nettingNo) return { type: 'netting', parsed: netting }
  if (sales.orders.length > 0) return { type: 'sales_report', parsed: sales }
  if (m2w.grossSalesInclVat != null) return { type: 'm2w', parsed: m2w }
  if (w2m.fees.length > 0 || w2m.totalInclVat != null) return { type: 'w2m', parsed: w2m }
  return { type: 'unknown', parsed: null }
}

export async function classifyPdf(buffer) {
  const [netting, sales, m2w, w2m] = await Promise.all([
    parseNetting(buffer),
    parseSalesReport(buffer),
    parseMerchantToWolt(buffer),
    parseWoltToMerchant(buffer),
  ])
  return classifyParsedPdf({ netting, sales, m2w, w2m })
}

export function classifyCsv(csvText) {
  const { meta } = Papa.parse(csvText, { header: true, preview: 1 })
  const cols = meta.fields || []
  const has = (name) => cols.includes(name)
  if (has('Item name') && has('Quantity') && has('Total')) return 'csv_items'
  if (has('Order placed') && has('Order number')) return 'csv_purchases'
  return 'unknown'
}
