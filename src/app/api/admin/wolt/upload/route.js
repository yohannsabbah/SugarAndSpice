import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { isAdmin } from '@/lib/admin'
import { periodNumForDate, periodDates } from '@/lib/parsers/wolt/period'
import { parseCsvItems } from '@/lib/parsers/wolt/parseCsvItems'
import { parseCsvPurchases } from '@/lib/parsers/wolt/parseCsvPurchases'
import {
  upsertWoltPeriod,
  replaceWoltPeriodFees,
  replaceWoltDeductions,
  replaceWoltPeriodItems,
  replaceWoltOrders,
  insertWoltOrderItems,
  findWoltPeriodByInvoiceNo,
} from '@/lib/db/wolt'

const PDF_MAGIC = '%PDF-'
// Period-establishing docs first (they can create a wolt_periods row from
// their own content), period-dependent docs last (they need that row to
// already exist, either from earlier in this same batch or from a prior
// upload).
const PRIORITY = { w2m: 0, m2w: 1, sales_report: 2, csv_items: 3, netting: 4, csv_purchases: 5, unknown: 6 }

export async function POST(req) {
  // Always answer with JSON, so the upload screen shows the real error
  // instead of a bare "Internal Server Error".
  try {
    return await handleUpload(req)
  } catch (e) {
    console.error('Wolt upload failed:', e)
    return NextResponse.json({ error: `Server error: ${e.message}` }, { status: 500 })
  }
}

async function handleUpload(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const files = form.getAll('files')
  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  // Loaded here, not at the top of the file: the PDF library can fail to load
  // on the server, and that error must reach the catch in POST.
  const { classifyPdf, classifyCsv } = await import('@/lib/parsers/wolt/classify')

  const classified = []
  const results = []
  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const isPdf = buffer.subarray(0, 5).toString('latin1') === PDF_MAGIC
      if (isPdf) {
        const { type, parsed } = await classifyPdf(buffer)
        classified.push({ filename: file.name, type, parsed })
      } else {
        const text = buffer.toString('utf8')
        const type = classifyCsv(text)
        classified.push({ filename: file.name, type, text })
      }
    } catch (e) {
      console.error(`Wolt upload: could not read ${file.name}:`, e)
      results.push({ filename: file.name, detected_type: 'unknown', status: 'error', detail: `Could not read file: ${e.message}` })
    }
  }

  classified.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])

  for (const file of classified) {
    try {
      const detail = await processFile(file)
      results.push({ filename: file.filename, detected_type: file.type, status: 'ok', detail })
    } catch (e) {
      results.push({ filename: file.filename, detected_type: file.type, status: 'error', detail: e.message })
    }
  }

  // The Wolt page's data reads are cached indefinitely (see db/wolt.js) —
  // this is what tells Next to recompute them on the next view instead of
  // serving stale data forever.
  revalidateTag('wolt-data')

  return NextResponse.json({ results })
}

async function processFile(file) {
  switch (file.type) {
    case 'w2m': return processW2m(file.parsed)
    case 'm2w': return processM2w(file.parsed)
    case 'sales_report': return processSalesReport(file.parsed)
    case 'netting': return processNetting(file.parsed)
    case 'csv_items': return processCsvItems(file.filename, file.text)
    case 'csv_purchases': return processCsvPurchases(file.text)
    default: throw new Error('Unrecognized file — not a known Wolt PDF or CSV')
  }
}

async function processW2m(w2m) {
  if (!w2m.periodStart) throw new Error('Could not read the billing period from this invoice')
  const { year, num } = periodNumForDate(w2m.periodStart)
  const periodId = await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    period_start: w2m.periodStart,
    period_end: w2m.periodEnd,
    invoice_date: w2m.invoiceDate,
    wolt_invoice_no: w2m.invoiceNo,
    wolt_fees_excl_vat: w2m.totalExclVat,
    wolt_fees_vat: w2m.totalVat,
    wolt_fees_incl_vat: w2m.totalInclVat,
    w2m_received_at: new Date().toISOString(),
  })
  await replaceWoltPeriodFees(periodId, w2m.fees.map((f) => ({
    fee_category: f.fee_category,
    description: f.description,
    units: f.units ?? null,
    base_amount: f.base ?? f.base_amount ?? null,
    amount_excl_vat: f.amount_excl_vat,
    vat_amount: f.vat_amount,
    amount_incl_vat: f.amount_incl_vat,
    campaign_id: f.campaign_id || null,
    campaign_start: f.campaign_start || null,
    campaign_end: f.campaign_end || null,
  })))
  return `Period ${year}-P${num} updated (${w2m.fees.length} fee lines)`
}

async function processM2w(m2w) {
  if (!m2w.periodStart) throw new Error('Could not read the billing period from this invoice')
  const { year, num } = periodNumForDate(m2w.periodStart)
  await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    period_start: m2w.periodStart,
    period_end: m2w.periodEnd,
    invoice_date: m2w.invoiceDate,
    merchant_invoice_no: m2w.invoiceNo,
    gross_sales_excl_vat: m2w.grossSalesExclVat,
    gross_sales_vat: m2w.grossSalesVat,
    gross_sales_incl_vat: m2w.grossSalesInclVat,
    refunds_incl_vat: m2w.refundsInclVat,
    m2w_received_at: new Date().toISOString(),
  })
  return `Period ${year}-P${num} updated (gross sales ${m2w.grossSalesInclVat})`
}

async function processSalesReport(sales) {
  if (!sales.orders.length) throw new Error('No order rows found in this sales report')
  const { year, num } = periodNumForDate(sales.orders[0].placed_at)
  await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    merchant_invoice_no: sales.merchantInvoiceNo,
    sales_report_received_at: new Date().toISOString(),
  })
  return `Period ${year}-P${num} confirmed (merchant invoice ${sales.merchantInvoiceNo || 'n/a'})`
}

async function processNetting(net) {
  const period = await findWoltPeriodByInvoiceNo({
    woltInvoiceNo: net.woltInvoiceNo,
    merchantInvoiceNo: net.merchantInvoiceNo,
  })
  if (!period) {
    throw new Error('No matching period found — upload the Wolt→Merchant and Merchant→Wolt invoices for this period too')
  }
  const installments_amount = (net.deductions || []).reduce((s, d) => s + (d.installment_amount || 0), 0)
  await upsertWoltPeriod({
    period_year: period.period_year,
    period_num: period.period_num,
    netting_no: net.nettingNo,
    withholding_amount: net.withholdingAmount,
    withholding_pct: net.withholdingPct,
    installments_amount,
    net_payout: net.netPayout,
    netting_received_at: new Date().toISOString(),
  })
  await replaceWoltDeductions(period.id, net.deductions)
  return `Period ${period.period_year}-P${period.period_num} updated (net payout ${net.netPayout})`
}

async function processCsvItems(filename, csvText) {
  const m = filename.match(/items_(\d{4}-\d{2}-\d{2})_/)
  if (!m) throw new Error("Filename doesn't match the expected items export pattern (items_YYYY-MM-DD_...)")
  const monthStart = m[1]
  const items = parseCsvItems(csvText, { monthStart })
  if (!items.length) throw new Error('Parsed to 0 item rows — wrong file?')
  await replaceWoltPeriodItems(monthStart, items)
  return `${items.length} item rows saved for month starting ${monthStart}`
}

async function processCsvPurchases(csvText) {
  const orders = parseCsvPurchases(csvText)
  if (!orders.length) throw new Error('Parsed to 0 order rows — wrong file?')

  const byPeriod = new Map()
  for (const o of orders) {
    const { year, num } = periodNumForDate(o.placed_at)
    const key = `${year}-${num}`
    if (!byPeriod.has(key)) byPeriod.set(key, { year, num, orders: [] })
    byPeriod.get(key).orders.push(o)
  }

  const summaries = []
  for (const { year, num, orders: pOrders } of byPeriod.values()) {
    // Upload order isn't guaranteed — this CSV may arrive before that
    // period's PDFs. Create the period stub from the CSV's own order dates
    // if needed; the PDFs (whenever they land) merge their financial data
    // into the same row rather than overwriting these dates.
    const { start, end } = periodDates(year, num)
    const periodId = await upsertWoltPeriod({
      period_year: year,
      period_num: num,
      period_start: start,
      period_end: end,
    })
    const orderRows = pOrders.map((o) => ({
      order_no_public: o.order_no_public,
      order_line_no: null,
      placed_at: o.placed_at,
      delivered_at: o.delivered_at,
      status: o.status,
      channel: o.channel,
      is_woltplus: false,
      price_incl_vat: o.price_incl_vat,
      price_excl_vat: null,
      review_score: o.review_score,
      review_comment: o.review_comment,
      review_attributions: o.review_attributions,
    }))
    const inserted = await replaceWoltOrders(periodId, orderRows)
    const idByOrderNo = new Map(inserted.map((r) => [r.order_no_public, r.id]))
    await insertWoltOrderItems(
      pOrders.flatMap((o) => {
        const orderId = idByOrderNo.get(o.order_no_public)
        return orderId ? (o.items || []).map((item) => ({ orderId, item })) : []
      }),
    )
    summaries.push(`period ${year}-P${num}: ${orderRows.length} orders imported`)
  }

  return summaries.join('; ')
}
