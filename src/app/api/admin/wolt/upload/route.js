import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { classifyPdf, classifyCsv } from '@/lib/parsers/wolt/classify'
import { periodNumForDate } from '@/lib/parsers/wolt/period'
import { parseCsvItems, parseCsvPurchases } from '@/lib/parsers/wolt'
import {
  upsertWoltPeriod,
  replaceWoltPeriodFees,
  replaceWoltDeductions,
  replaceWoltPeriodItems,
  replaceWoltOrders,
  insertWoltOrderItems,
  findWoltPeriodByInvoiceNo,
  findWoltPeriodId,
} from '@/lib/db/wolt'

const PDF_MAGIC = '%PDF-'
// Period-establishing docs first (they can create a wolt_periods row from
// their own content), period-dependent docs last (they need that row to
// already exist, either from earlier in this same batch or from a prior
// upload).
const PRIORITY = { w2m: 0, m2w: 1, sales_report: 2, csv_items: 3, netting: 4, csv_purchases: 5, unknown: 6 }

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const files = form.getAll('files')
  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const classified = []
  for (const file of files) {
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
  }

  classified.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])

  const results = []
  for (const file of classified) {
    try {
      const detail = await processFile(file)
      results.push({ filename: file.filename, detected_type: file.type, status: 'ok', detail })
    } catch (e) {
      results.push({ filename: file.filename, detected_type: file.type, status: 'error', detail: e.message })
    }
  }

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
  let anyImported = false
  for (const { year, num, orders: pOrders } of byPeriod.values()) {
    const periodId = await findWoltPeriodId(year, num)
    if (!periodId) {
      summaries.push(`period ${year}-P${num}: SKIPPED (${pOrders.length} orders, no matching period — upload its invoices first)`)
      continue
    }
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
    for (const o of pOrders) {
      const orderId = idByOrderNo.get(o.order_no_public)
      if (orderId && o.items?.length) await insertWoltOrderItems(orderId, o.items)
    }
    anyImported = true
    summaries.push(`period ${year}-P${num}: ${orderRows.length} orders imported`)
  }

  if (!anyImported) throw new Error(summaries.join('; '))
  return summaries.join('; ')
}
