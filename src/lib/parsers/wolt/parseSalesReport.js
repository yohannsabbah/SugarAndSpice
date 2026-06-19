import { pdfText, lines, num, ddmmyyyy, fields } from './text-utils.js'

// Each order row has the shape:
//   <DD.MM.YYYY>\t<HH?HH?HH>\t<seq>\t<כן|לא>\t<order_no>\t<price_incl>\t<price_excl>\t<משלוח|לקחת>[\t<daily_total>]
// The HH:MM:SS time field uses NULL chars (0x00) as separators between digit
// pairs in some periods and ':' or ' ' in others — match any single non-tab.
const ORDER_RE = /^(\d{2}\.\d{2}\.\d{4})\t(\d{2})[^\t](\d{2})[^\t](\d{2})\t(\d+)\t(לא|כן)\t(\d+)\t([\d,.]+)\t([\d,.]+)\t(משלוח|לקחת)/

const CHANNEL_MAP = { 'משלוח': 'delivery', 'לקחת': 'pickup' }

const LABELS = {
  invoiceNo: "חשבונית 'מס", // used to confirm merchant_invoice_no
}

export async function parseSalesReport(buffer) {
  const text = await pdfText(buffer)
  const ls = lines(text)

  let merchantInvoiceNo = null

  // Walk through lines looking for invoice header and order rows.
  // Some invoice-no lines look like "660009 :מספר מס חשבונית עבור פירוט"
  for (const l of ls) {
    if (merchantInvoiceNo) break
    const m = l.match(/(\d{6})\s*:\s*מספר\s*מס\s*חשבונית\s*עבור\s*פירוט/)
    if (m) merchantInvoiceNo = m[1]
  }
  // Fallback: any "<number>\t<mention of חשבונית 'מס>"
  if (!merchantInvoiceNo) {
    for (const l of ls) {
      if (l.includes(LABELS.invoiceNo)) {
        const m = l.match(/^(\d{6})\s/)
        if (m) { merchantInvoiceNo = m[1]; break }
      }
    }
  }

  const orders = []
  for (const l of ls) {
    const m = l.match(ORDER_RE)
    if (!m) continue
    const dateIso = ddmmyyyy(m[1])
    const time = `${m[2]}:${m[3]}:${m[4]}`
    orders.push({
      placed_at: `${dateIso}T${time}`, // local time, no TZ — caller can apply +03:00
      seq: Number(m[5]),
      is_woltplus: m[6] === 'כן',
      order_line_no: m[7],
      price_incl_vat: num(m[8]),
      price_excl_vat: num(m[9]),
      channel: CHANNEL_MAP[m[10]] || 'delivery',
    })
  }

  return {
    docType: 'wolt_sales_pdf',
    merchantInvoiceNo,
    orders,
  }
}
