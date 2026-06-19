import { pdfText, lines, num, fields } from './text-utils.js'

// Label strings as they actually appear in pdf-parse output for this doc type
// (verified empirically against periods 7–10).
const LABELS = {
  nettingNo:    "מספר ריכוז",
  withholding:  "ניכוי במקור",
  woltProducts: "Wolt מוצרי",
  installmentValueRow: /^\d{7,}\t\d{6,}\t/, // <invoice>\t<receipt>\t…
  netPayout:    "סה״כ תשלום לשותף",
}

export async function parseNetting(buffer) {
  const text = await pdfText(buffer)
  const ls = lines(text)

  let nettingNo = null
  let merchantInvoiceNo = null
  let woltInvoiceNo = null
  let withholdingAmount = null
  let withholdingPct = null
  let netPayout = null
  const deductions = []

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]

    if (!nettingNo && l.includes(LABELS.nettingNo)) {
      const m = l.match(/^(\d+)\s/)
      if (m) nettingNo = m[1]
    }

    if (l.includes(LABELS.withholding)) {
      // "ניכוי במקור  <gross_basis_incl_vat>  <pct>%  <amount>"
      const f = fields(l)
      if (f.length >= 4) {
        withholdingPct = num(f[2])
        withholdingAmount = num(f[3])
      }
    }

    if (l.includes(LABELS.woltProducts)) {
      // "מוצרי Wolt  <invoice_no>  <excl>  <vat>  <incl>"
      const f = fields(l)
      if (f.length >= 5) woltInvoiceNo = f[1]
    }

    // Merchant sale invoice line — under the "מסמכי מכירה של בית העסק" header.
    // Format: "<business name with venue>  <invoice_no>  <excl>  <vat>  <incl>"
    // We grab the first 6-digit invoice number that appears in a tab-separated
    // line BEFORE the "ניכוי במקור" row.
    if (!merchantInvoiceNo) {
      const f = fields(l)
      if (f.length >= 5 && /^\d{6}$/.test(f[1] || '')) {
        // Only accept if this line comes before withholding (we set withhold below)
        merchantInvoiceNo = f[1]
      }
    }

    // Installment value row: detect by pattern <7+digits>\t<6+digits>\t<money>\t...
    if (LABELS.installmentValueRow.test(l)) {
      const f = fields(l)
      // Description is the line(s) immediately preceding this row.
      // Walk backwards collecting lines that are not other value rows / not "סה"כ".
      const descLines = []
      let j = i - 1
      while (j >= 0) {
        const prev = ls[j]
        if (
          LABELS.installmentValueRow.test(prev) ||
          /^סה"כ/.test(prev) ||
          prev.includes(LABELS.netPayout) ||
          prev.includes('סה״כ תשלום') ||
          prev.includes(LABELS.woltProducts) ||
          prev.includes(LABELS.withholding) ||
          prev.includes('הנוכחי') ||
          prev.includes('חלק') ||
          /^מכירה בתשלומים/.test(prev)
        ) break
        descLines.unshift(prev)
        j--
        if (descLines.length >= 4) break
      }

      // f: [original_invoice_no, receipt_no, total_price, remaining_after, part, payment]
      deductions.push({
        item_description: descLines.join(' ').trim(),
        original_invoice_no: f[0],
        receipt_no: f[1],
        total_price_incl_vat: num(f[2]),
        remaining_after_payment: num(f[3]),
        installment_num: Math.round(num(f[4])),
        installment_amount: num(f[5]),
      })
    }

    if (l.includes(LABELS.netPayout)) {
      const f = fields(l)
      if (f.length >= 2) netPayout = num(f[1])
    }
  }

  return {
    docType: 'wolt_netting',
    nettingNo,
    merchantInvoiceNo,
    woltInvoiceNo,
    withholdingAmount,
    withholdingPct,
    deductions,
    netPayout,
  }
}
