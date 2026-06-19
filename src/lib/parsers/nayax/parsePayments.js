import Papa from 'papaparse'
import { fixMojibake, stripBom, toNumber } from './text-utils.js'

// Nayax "payments" CSV is two SSRS sections concatenated:
//
//   Section 1 — Cash row only:
//     TextBox10,TextBox32,TextBox44,TextBox59,TextBox63,TextBox67
//     "מזומן","334","10531.15","4","-205.05","10326.1"
//
//   Section 2 — Card brand rows + a "Credit Card" subtotal + grand total:
//     CredCard111,TextBox5,TextBox6,TextBox11,...,TextBox29,...,TextBox47
//     "","","","","","","   אמקס","9","334.5","0","0","334.5","",...     ← card brand
//     "Credit Card","566","23299.1","0","0","23299.1","","",...           ← credit subtotal (skip)
//     "","","",...,"898","33830.25","4","-205.05","33625.2"               ← grand total
//
// Returns:
//   { methods:  [{ method, orders, gross_incl_vat, refund_count,
//                  refunds_incl_vat, net_incl_vat }, …],     // cash + each card brand
//     totals:   { orders, gross_incl_vat, refund_count,
//                 refunds_incl_vat, net_incl_vat } | null }
//
// `refunds_incl_vat` is stored as a POSITIVE number even though the source
// CSV writes refunds as negatives — easier to reason about in the dashboard.

// Hebrew labels Nayax uses. We mojibake-fix the cell first, then match these.
const METHOD_LABELS = [
  { match: /^מזומן$/,        method: 'cash' },
  { match: /^אמקס$/,         method: 'amex' },
  { match: /^דיינרס$/,       method: 'diners' },
  { match: /^ויזה$/,         method: 'visa' },
  { match: /^מאסטרקרד$/,     method: 'mastercard' },
  { match: /^מסטרקארד$/,     method: 'mastercard' }, // alt spelling, just in case
]

function normalizeMethod(label) {
  const trimmed = (label || '').trim()
  for (const { match, method } of METHOD_LABELS) {
    if (match.test(trimmed)) return method
  }
  return null
}

export function parsePayments(csvText) {
  const { data } = Papa.parse(csvText, { header: false, skipEmptyLines: true })
  const methods = []
  let totals = null

  for (const rawRow of data) {
    const row = rawRow.map((c, i) => (i === 0 ? stripBom(c ?? '') : c ?? '')).map(fixMojibake)

    // Find the first cell that looks like a payment-method label.
    let labelIdx = -1
    let method = null
    for (let i = 0; i < row.length; i++) {
      const m = normalizeMethod(row[i])
      if (m) { labelIdx = i; method = m; break }
    }

    if (method) {
      // Next 5 cells are [orders, gross, refund_count, refund_amount, net].
      const orders        = toNumber(row[labelIdx + 1]) ?? 0
      const gross         = toNumber(row[labelIdx + 2]) ?? 0
      const refund_count  = toNumber(row[labelIdx + 3]) ?? 0
      const refundsRaw    = toNumber(row[labelIdx + 4]) ?? 0
      const net           = toNumber(row[labelIdx + 5]) ?? 0
      methods.push({
        method,
        orders,
        gross_incl_vat: gross,
        refund_count,
        refunds_incl_vat: Math.abs(refundsRaw),
        net_incl_vat: net,
      })
      continue
    }

    // Grand-total row: every label cell is empty, but the trailing 5 cells
    // (TextBox29..TextBox35, indices 12..16 in the section-2 layout) carry
    // the all-method totals. Spot it by checking those 5 are all numeric and
    // earlier cells are empty.
    const tail = row.slice(-5).map(toNumber)
    const everythingBeforeEmpty = row.slice(0, -5).every((c) => !c || !String(c).trim())
    if (everythingBeforeEmpty && tail.every((v) => v != null)) {
      const [orders, gross, refund_count, refundsRaw, net] = tail
      totals = {
        orders,
        gross_incl_vat: gross,
        refund_count,
        refunds_incl_vat: Math.abs(refundsRaw),
        net_incl_vat: net,
      }
    }
  }

  return { methods, totals }
}
