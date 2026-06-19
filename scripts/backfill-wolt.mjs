// Backfill Wolt data (Apr–May 2026) from local files into Supabase.
//
// Run from webapp/:
//   node --env-file=.env.local scripts/backfill-wolt.mjs
//
// Idempotent — safe to re-run. Each period replaces its child rows.

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

import {
  parseWoltToMerchant,
  parseMerchantToWolt,
  parseNetting,
  parseSalesReport,
  parseCsvPurchases,
  parseCsvItems,
} from '../src/lib/parsers/wolt/index.js'

const DATA_DIR = path.resolve(process.cwd(), '../data/wolt/2026')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── helpers ────────────────────────────────────────────────────────────────
function periodDates(year, num) {
  const month = Math.ceil(num / 2)
  const isFirstHalf = num % 2 === 1
  const lastDay = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  return {
    start: isFirstHalf ? `${year}-${mm}-01` : `${year}-${mm}-16`,
    end:   isFirstHalf ? `${year}-${mm}-15` : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}

function periodNumForDate(isoDate) {
  // 'YYYY-MM-DD' → 1..24
  const [y, m, d] = isoDate.split('-').map(Number)
  return { year: y, num: (m - 1) * 2 + (d <= 15 ? 1 : 2) }
}

const CATEGORY_RULES = [
  [/iced|cold|frappe|אייס|קר/i, 'coffee_cold'],
  [/espresso|cappuc?ino|latte|americano|mocha|קפה|אספרסו|מוקה/i, 'coffee_hot'],
  [/matcha|מאצ['׳]?ה/i, 'matcha'],
  [/mochi|מוצ['׳]?י/i, 'mochi'],
  [/tea|תה/i, 'tea'],
  [/soda|סודה/i, 'soda'],
  [/cake|עוג(?:ת|ה)|cheesecake|honey|red velvet|sebastian|truffle/i, 'cake'],
  [/brownie|ברוני|cookie|cookies|alfajores|cupcake|cup ?cake|carrot/i, 'pastry'],
  [/(?:^|[ ])kids|פרפה/i, 'kids'],
  [/poke|קינוא|סלמון|סלט|bowl|קער[הת]/i, 'food'],
  [/panna ?cotta|פנה ?קוטה|sh[uo]|"shu"|"שו"/i, 'pastry'],
]
function inferCategory(name) {
  if (!name) return 'other'
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat
  return 'other'
}

const itemCache = new Map()
async function upsertItem({ merchant_sku, display_name }) {
  const key = merchant_sku ? `sku:${merchant_sku}` : `name:${display_name}`
  if (itemCache.has(key)) return itemCache.get(key)
  let q = supabase.from('items').select('id')
  if (merchant_sku) q = q.eq('merchant_sku', merchant_sku)
  else q = q.eq('display_name', display_name).is('merchant_sku', null)
  const { data: existing } = await q.maybeSingle()
  if (existing) { itemCache.set(key, existing.id); return existing.id }
  const { data, error } = await supabase
    .from('items')
    .insert({ merchant_sku: merchant_sku || null, display_name, category: inferCategory(display_name) })
    .select('id').single()
  if (error) throw error
  itemCache.set(key, data.id)
  return data.id
}

function mergeNonNull(base, incoming) {
  const out = { ...base }
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

async function upsertPeriod(merged) {
  const { data: existing } = await supabase
    .from('wolt_periods').select('*')
    .eq('period_year', merged.period_year)
    .eq('period_num', merged.period_num)
    .maybeSingle()
  const row = mergeNonNull(existing || {}, merged)
  // net_sales_incl_vat comes straight from the M2W parser's grand-total line.
  // We do NOT re-derive it here — refunds_incl_vat can be signed (negative when
  // corrections augmented sales, like P8), and the parser's net is authoritative.
  row.updated_at = new Date().toISOString()
  if (existing) {
    const { error } = await supabase.from('wolt_periods').update(row).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }
  const { data, error } = await supabase
    .from('wolt_periods').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

async function insertDoc(doc) {
  // Idempotent on file_path (do nothing if already present)
  const { data: existing } = await supabase
    .from('documents').select('id').eq('file_path', doc.file_path).maybeSingle()
  if (existing) {
    await supabase.from('documents').update({ parse_status: 'parsed', parsed_at: new Date().toISOString() }).eq('id', existing.id)
    return existing.id
  }
  const { data, error } = await supabase.from('documents').insert({
    file_path: doc.file_path, file_name: doc.file_name,
    source: 'wolt', doc_type: doc.doc_type,
    period_start: doc.period_start, period_end: doc.period_end,
    parse_status: 'parsed', parsed_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw error
  return data.id
}

// ─── PDF packet processing ───────────────────────────────────────────────────
async function processPeriod(periodNum) {
  const { start, end } = periodDates(2026, periodNum)
  const dirName = `period-${String(periodNum).padStart(2, '0')}`
  const dir = path.join(DATA_DIR, dirName)
  const files = await readdir(dir)

  const w2mFile = files.find((f) => /WOLT_TO_MERCHANT_INVOICE/i.test(f))
  const m2wFile = files.find((f) => /MERCHANT_TO_WOLT_INVOICE/i.test(f))
  const netFile = files.find((f) => /NETTING_REPORT/i.test(f))
  const salFile = files.find((f) => /SALES_REPORT/i.test(f))
  if (!w2mFile || !m2wFile || !netFile || !salFile) {
    console.warn(`  ! period ${periodNum}: missing files`); return
  }

  const w2m = await parseWoltToMerchant(await readFile(path.join(dir, w2mFile)))
  const m2w = await parseMerchantToWolt(await readFile(path.join(dir, m2wFile)))
  const net = await parseNetting(await readFile(path.join(dir, netFile)))
  const sal = await parseSalesReport(await readFile(path.join(dir, salFile)))

  // Upsert period (merging fields from each parser)
  const periodId = await upsertPeriod({
    period_year: 2026,
    period_num: periodNum,
    period_start: w2m.periodStart || start,
    period_end: w2m.periodEnd || end,
    invoice_date: w2m.invoiceDate || net?.invoiceDate || null,
    wolt_invoice_no: w2m.invoiceNo,
    merchant_invoice_no: m2w.invoiceNo || sal.merchantInvoiceNo,
    netting_no: net.nettingNo,
    gross_sales_excl_vat: m2w.grossSalesExclVat,
    gross_sales_vat: m2w.grossSalesVat,
    gross_sales_incl_vat: m2w.grossSalesInclVat,
    refunds_incl_vat: m2w.refundsInclVat,
    net_sales_incl_vat: m2w.netSalesInclVat,
    wolt_fees_excl_vat: w2m.totalExclVat,
    wolt_fees_vat: w2m.totalVat,
    wolt_fees_incl_vat: w2m.totalInclVat,
    withholding_amount: net.withholdingAmount,
    withholding_pct: net.withholdingPct,
    installments_amount: (net.deductions || []).reduce((s, d) => s + (d.installment_amount || 0), 0),
    net_payout: net.netPayout,
  })

  // Replace fees
  await supabase.from('wolt_period_fees').delete().eq('period_id', periodId)
  if (w2m.fees.length) {
    const rows = w2m.fees.map((f) => ({
      period_id: periodId,
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
    }))
    const { error } = await supabase.from('wolt_period_fees').insert(rows)
    if (error) throw error
  }

  // Replace deductions
  await supabase.from('wolt_deductions').delete().eq('period_id', periodId)
  if (net.deductions.length) {
    const rows = net.deductions.map((d) => ({ period_id: periodId, ...d }))
    const { error } = await supabase.from('wolt_deductions').insert(rows)
    if (error) throw error
  }

  // Register the 4 source documents
  const relDir = `data/wolt/2026/${dirName}`
  await insertDoc({ file_path: `${relDir}/${w2mFile}`, file_name: w2mFile, doc_type: 'wolt_invoice_w2m', period_start: start, period_end: end })
  await insertDoc({ file_path: `${relDir}/${m2wFile}`, file_name: m2wFile, doc_type: 'wolt_invoice_m2w', period_start: start, period_end: end })
  await insertDoc({ file_path: `${relDir}/${netFile}`, file_name: netFile, doc_type: 'wolt_netting',     period_start: start, period_end: end })
  await insertDoc({ file_path: `${relDir}/${salFile}`, file_name: salFile, doc_type: 'wolt_sales_pdf',   period_start: start, period_end: end })

  console.log(`  ✓ Period ${periodNum} (${start}…${end})  fees=${w2m.fees.length}  ded=${net.deductions.length}  payout=${net.netPayout}`)
  return periodId
}

// ─── CSV processing ──────────────────────────────────────────────────────────
async function processItemsCsv(filename) {
  const m = filename.match(/items_(\d{4}-\d{2}-\d{2})_/)
  if (!m) return
  const monthStart = m[1]
  const csv = await readFile(path.join(DATA_DIR, 'csv', filename), 'utf8')
  const items = parseCsvItems(csv, { monthStart })

  await supabase.from('wolt_period_items').delete().eq('month_start', monthStart)
  const rows = []
  for (const it of items) {
    const itemId = await upsertItem({ merchant_sku: it.merchant_sku, display_name: it.item_name })
    rows.push({ month_start: monthStart, item_id: itemId, item_name: it.item_name, merchant_sku: it.merchant_sku, units_sold: it.units_sold, revenue_incl_vat: it.revenue_incl_vat })
  }
  if (rows.length) {
    const { error } = await supabase.from('wolt_period_items').insert(rows)
    if (error) throw error
  }

  await insertDoc({
    file_path: `data/wolt/2026/csv/${filename}`,
    file_name: filename,
    doc_type: 'wolt_csv_items',
    period_start: monthStart,
    period_end: null,
  })

  console.log(`  ✓ Items CSV ${monthStart}  rows=${rows.length}`)
}

async function processPurchasesCsv(filename, periodIdByKey) {
  const m = filename.match(/purchases_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/)
  if (!m) return
  const csv = await readFile(path.join(DATA_DIR, 'csv', filename), 'utf8')
  const orders = parseCsvPurchases(csv)

  // Group orders by period
  const byPeriod = new Map()
  for (const o of orders) {
    const { year, num } = periodNumForDate(o.placed_at.slice(0, 10))
    const key = `${year}-${num}`
    if (!byPeriod.has(key)) byPeriod.set(key, { year, num, orders: [] })
    byPeriod.get(key).orders.push(o)
  }

  for (const { year, num, orders: pOrders } of byPeriod.values()) {
    const periodId = periodIdByKey.get(`${year}-${num}`)
    if (!periodId) { console.warn(`  ! no period ${year}-${num} for ${pOrders.length} orders`); continue }

    // Replace orders for this period
    await supabase.from('wolt_orders').delete().eq('period_id', periodId)
    const orderRows = pOrders.map((o) => ({
      period_id: periodId,
      order_no_public: o.order_no_public,
      order_line_no: null,
      placed_at: o.placed_at,
      delivered_at: o.delivered_at,
      status: o.status,
      channel: o.channel,
      is_woltplus: false, // CSV doesn't expose Wolt+; PDF sales report does
      price_incl_vat: o.price_incl_vat,
      price_excl_vat: null,
      review_score: o.review_score,
      review_comment: o.review_comment,
      review_attributions: o.review_attributions,
    }))
    const { data: inserted, error: oe } = await supabase
      .from('wolt_orders').insert(orderRows).select('id, order_no_public')
    if (oe) throw oe

    // Insert items for each order
    const idByOrderNo = new Map(inserted.map((r) => [r.order_no_public, r.id]))
    const itemRows = []
    for (const o of pOrders) {
      const orderId = idByOrderNo.get(o.order_no_public)
      if (!orderId || !o.items?.length) continue
      for (const it of o.items) {
        const itemId = await upsertItem({ merchant_sku: null, display_name: it.item_name })
        itemRows.push({
          order_id: orderId, item_id: itemId,
          item_name: it.item_name, merchant_sku: null,
          quantity: it.quantity, unit_price_incl_vat: it.unit_price_incl_vat,
          line_total_incl_vat: it.line_total_incl_vat,
        })
      }
    }
    if (itemRows.length) {
      const { error } = await supabase.from('wolt_order_items').insert(itemRows)
      if (error) throw error
    }

    console.log(`  ✓ Period ${num} (${year}) orders: ${orderRows.length} (incl ${pOrders.filter(o => o.status === 'rejected').length} rejected)  items: ${itemRows.length}`)
  }

  // Register the CSV document with first period_start..last period_end of month
  await insertDoc({
    file_path: `data/wolt/2026/csv/${filename}`,
    file_name: filename,
    doc_type: 'wolt_csv_purchases',
    period_start: m[1],
    period_end: null,
  })
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_KEY. Run with node --env-file=.env.local')
  }
  console.log('▶ Backfilling Wolt Apr–May 2026 into Supabase…\n')

  const periodIdByKey = new Map()
  for (const num of [7, 8, 9, 10]) {
    const id = await processPeriod(num)
    if (id) periodIdByKey.set(`2026-${num}`, id)
  }

  console.log('')
  await processItemsCsv('sugar-spice-haifa_items_2026-04-01_2026-05-01.csv')
  await processItemsCsv('sugar-spice-haifa_items_2026-05-01_2026-06-01.csv')

  console.log('')
  await processPurchasesCsv('sugar-spice-haifa_purchases_2026-04-01_2026-05-01.csv', periodIdByKey)
  await processPurchasesCsv('sugar-spice-haifa_purchases_2026-05-01_2026-06-01.csv', periodIdByKey)

  console.log('\n✓ Backfill complete.\n')

  // Quick sanity check
  const { count: periods } = await supabase.from('wolt_periods').select('*', { count: 'exact', head: true })
  const { count: orders } = await supabase.from('wolt_orders').select('*', { count: 'exact', head: true })
  const { count: items } = await supabase.from('items').select('*', { count: 'exact', head: true })
  const { count: fees } = await supabase.from('wolt_period_fees').select('*', { count: 'exact', head: true })
  console.log(`Rows now in DB:  periods=${periods}  orders=${orders}  items=${items}  fees=${fees}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
