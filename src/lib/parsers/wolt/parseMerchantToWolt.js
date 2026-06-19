import { pdfText, lines, num, ddmmyyyy, fields } from './text-utils.js'

const LABELS = {
  invoiceDate: "חשבונית תאריך",
  invoiceNo:   "חשבונית 'מס",
  period:      "החיוב תקופת",
  sales:       "מכירות כ\"סה",   // "סה"כ מכירות"
  // Refund/correction lines vary: "תיקון לרכישה: תוספות" or "סה"כ ניכויים"
  refunds:     ["תיקון", "ניכויים"],
  grandTotal:  "מע״מ 18.00% בחיוב מוצרים סה״כ", // "סה״כ מוצרים בחיוב 18.00% מע״מ"
}

export async function parseMerchantToWolt(buffer) {
  const text = await pdfText(buffer)
  const ls = lines(text)

  let invoiceDate = null, invoiceNo = null, periodStart = null, periodEnd = null
  let grossExcl = null, grossVat = null, grossIncl = null
  let totalExcl = null, totalVat = null, totalIncl = null

  for (const l of ls) {
    if (!invoiceDate && l.includes(LABELS.invoiceDate)) {
      invoiceDate = ddmmyyyy(l.split('\t')[0].trim())
    }
    if (!invoiceNo && l.includes(LABELS.invoiceNo)) {
      const m = l.match(/^(\d+)\s/)
      if (m) invoiceNo = m[1]
    }
    if (!periodStart && l.includes(LABELS.period)) {
      const m = l.match(/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/)
      if (m) { periodEnd = ddmmyyyy(m[1]); periodStart = ddmmyyyy(m[2]) }
    }

    if (grossIncl == null && l.includes(LABELS.sales)) {
      // "סה"כ מכירות"  <excl>  <vat%>  <vat>  <incl>
      const f = fields(l)
      if (f.length >= 5) {
        grossExcl = num(f[1]); grossVat = num(f[3]); grossIncl = num(f[4])
      }
      continue
    }

    // Refund / correction rows: skipped here. We compute refunds from the
    // identity (refunds_incl_vat = gross - net) after reading the grand total,
    // which gives correct signed values (negative when net > gross, e.g. P8's
    // "תיקון לרכישה: תוספות" addition of +82 means net is higher than gross).

    if (totalIncl == null && l.includes(LABELS.grandTotal)) {
      // Grand total row has 4 cols (no vat% shown): "<label>  <excl>  <vat>  <incl>"
      const f = fields(l)
      if (f.length >= 4) {
        totalExcl = num(f[1]); totalVat = num(f[2]); totalIncl = num(f[3])
      }
    }
  }

  // Signed refunds = gross - net. Positive when sales were reduced (P10 case),
  // negative when sales were augmented by corrections (P8 case).
  const refundsExclVat = grossExcl != null && totalExcl != null ? +(grossExcl - totalExcl).toFixed(2) : 0
  const refundsVat     = grossVat  != null && totalVat  != null ? +(grossVat  - totalVat ).toFixed(2) : 0
  const refundsInclVat = grossIncl != null && totalIncl != null ? +(grossIncl - totalIncl).toFixed(2) : 0

  return {
    docType: 'wolt_invoice_m2w',
    invoiceNo,
    invoiceDate,
    periodStart,
    periodEnd,
    grossSalesExclVat: grossExcl,
    grossSalesVat: grossVat,
    grossSalesInclVat: grossIncl,
    refundsExclVat,
    refundsVat,
    refundsInclVat,
    netSalesExclVat: totalExcl,
    netSalesVat: totalVat,
    netSalesInclVat: totalIncl,
  }
}
