// Backfill Nayax (in-store POS) monthly data into Supabase.
//
// Reads three CSVs per month from data/nayax/YYYY/MM/:
//   - hourly.csv    (24 rows of hourly revenue/orders/avg-ticket)
//   - items.csv     (item-by-category breakdown for the whole month)
//   - payments.csv  (cash + credit-card brand split with refunds)
//
// Run from webapp/:
//   node --env-file=.env.local scripts/backfill-nayax.mjs              # all months found
//   node --env-file=.env.local scripts/backfill-nayax.mjs 2026-05      # one specific month
//
// Idempotent — safe to re-run. Each period replaces its child rows.

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

import {
  parseHourly,
  parsePayments,
  parseItems,
} from '../src/lib/parsers/nayax/index.js'

const DATA_ROOT = path.resolve(process.cwd(), '../data/nayax')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── items catalog (shared with Wolt) ──────────────────────────────────────
// Keep these rules in sync with src/lib/db/wolt.js → CATEGORY_RULES.
const CATEGORY_RULES = [
  [/iced|cold|frappe|אייס|קר/i, 'coffee_cold'],
  [/espresso|cappuc?ino|latte|americano|mocha|raf|קפה|אספרסו|מוקה/i, 'coffee_hot'],
  [/matcha|מאצ['׳]?ה/i, 'matcha'],
  [/mochi|מוצ['׳]?י/i, 'mochi'],
  [/tea|תה/i, 'tea'],
  [/soda|סודה/i, 'soda'],
  [/cake|עוג(?:ת|ה)|cheesecake|honey|red velvet|sebastian|truffle/i, 'cake'],
  [/brownie|ברוני|cookie|cookies|alfa(?:jo|ho)res|cupcake|cup ?cake|carrot/i, 'pastry'],
  [/ice ?cream|גלידה/i, 'pastry'],
  [/(?:^|[ ])kids|פרפה/i, 'kids'],
  [/poke|קינוא|סלמון|סלט|bowl|קער[הת]/i, 'food'],
  [/panna ?cotta|פנה ?קוטה|sh[uo]|"shu"|"שו"/i, 'pastry'],
  [/sun ?juice|natural|סחוט|juice/i, 'soda'],
  [/spatula|^fork$|^big ?cup$|cute|toy|knited/i, 'merch'],
  [/syrup|maison/i, 'other'],
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

// ─── per-month processing ──────────────────────────────────────────────────
async function processMonth(year, month) {
  const dir = path.join(DATA_ROOT, String(year), String(month).padStart(2, '0'))
  const periodMonth = `${year}-${String(month).padStart(2, '0')}-01`
  const monthLabel = new Date(periodMonth).toLocaleString('en-IL', { month: 'long', year: 'numeric' })

  let hourlyCsv, itemsCsv, paymentsCsv
  try {
    [hourlyCsv, itemsCsv, paymentsCsv] = await Promise.all([
      readFile(path.join(dir, 'hourly.csv'), 'utf8'),
      readFile(path.join(dir, 'items.csv'), 'utf8'),
      readFile(path.join(dir, 'payments.csv'), 'utf8'),
    ])
  } catch (e) {
    console.warn(`  ! ${monthLabel}: missing CSV (${e.code || e.message})`)
    return
  }

  const hourly = parseHourly(hourlyCsv)
  const items = parseItems(itemsCsv)
  const payments = parsePayments(paymentsCsv)

  // Reconciliation — warn on mismatches but proceed.
  const ordersFromHours = hourly.hours.reduce((s, h) => s + h.orders, 0)
  const revenueFromHours = hourly.hours.reduce((s, h) => s + h.revenue, 0)
  const checks = [
    ['hourly orders == payments orders',
      ordersFromHours, payments.totals?.orders],
    ['hourly revenue == payments gross',
      Number(revenueFromHours.toFixed(2)), Number(payments.totals?.gross_incl_vat?.toFixed(2))],
    ['items revenue sum == items grand_total',
      Number(items.items.reduce((s, i) => s + i.revenue_incl_vat, 0).toFixed(2)),
      Number(items.grand_total?.revenue_incl_vat?.toFixed(2))],
    ['items revenue == payments net',
      Number(items.grand_total?.revenue_incl_vat?.toFixed(2)),
      Number(payments.totals?.net_incl_vat?.toFixed(2))],
  ]
  for (const [label, a, b] of checks) {
    const ok = a === b
    console.log(`  ${ok ? '✓' : '⚠'} ${label}: ${a} vs ${b}`)
  }

  // Upsert period.
  const totals = payments.totals || {}
  const periodPayload = {
    period_month: periodMonth,
    period_label: monthLabel,
    gross_incl_vat: totals.gross_incl_vat ?? null,
    refunds_incl_vat: totals.refunds_incl_vat ?? 0,
    net_incl_vat: totals.net_incl_vat ?? null,
    total_orders: totals.orders ?? null,
    refund_count: totals.refund_count ?? 0,
    units_sold: items.grand_total?.units_sold ?? null,
    avg_ticket: totals.orders ? Number(totals.net_incl_vat) / totals.orders : null,
    updated_at: new Date().toISOString(),
  }
  const { data: existing } = await supabase
    .from('nayax_periods').select('id').eq('period_month', periodMonth).maybeSingle()
  let periodId
  if (existing) {
    const { error } = await supabase.from('nayax_periods').update(periodPayload).eq('id', existing.id)
    if (error) throw error
    periodId = existing.id
  } else {
    const { data, error } = await supabase
      .from('nayax_periods').insert(periodPayload).select('id').single()
    if (error) throw error
    periodId = data.id
  }

  // Replace hours.
  await supabase.from('nayax_period_hours').delete().eq('period_id', periodId)
  if (hourly.hours.length) {
    const rows = hourly.hours.map((h) => ({ period_id: periodId, ...h }))
    const { error } = await supabase.from('nayax_period_hours').insert(rows)
    if (error) throw error
  }

  // Replace payments.
  await supabase.from('nayax_period_payments').delete().eq('period_id', periodId)
  if (payments.methods.length) {
    const rows = payments.methods.map((m) => ({ period_id: periodId, ...m }))
    const { error } = await supabase.from('nayax_period_payments').insert(rows)
    if (error) throw error
  }

  // Replace items (with item_id resolution).
  await supabase.from('nayax_period_items').delete().eq('period_id', periodId)
  if (items.items.length) {
    const rows = []
    for (const it of items.items) {
      const itemId = await upsertItem({
        merchant_sku: it.merchant_sku || null,
        display_name: it.item_name,
      })
      rows.push({
        period_id: periodId,
        item_id: itemId,
        item_name: it.item_name,
        merchant_sku: it.merchant_sku || null,
        raw_category: it.raw_category || null,
        units_sold: it.units_sold,
        revenue_incl_vat: it.revenue_incl_vat,
        avg_price_incl_vat: it.avg_price_incl_vat ?? null,
        share_of_total: it.share_of_total ?? null,
      })
    }
    const { error } = await supabase.from('nayax_period_items').insert(rows)
    if (error) throw error
  }

  console.log(`  ✓ ${monthLabel}: ${items.items.length} items, ${hourly.hours.length} hours, ${payments.methods.length} payment methods`)
}

// ─── discovery: list all data/nayax/YYYY/MM/ dirs ─────────────────────────
async function discoverMonths() {
  const out = []
  for (const yEntry of await readdir(DATA_ROOT, { withFileTypes: true })) {
    if (!yEntry.isDirectory() || !/^\d{4}$/.test(yEntry.name)) continue
    for (const mEntry of await readdir(path.join(DATA_ROOT, yEntry.name), { withFileTypes: true })) {
      if (!mEntry.isDirectory() || !/^\d{2}$/.test(mEntry.name)) continue
      out.push({ year: Number(yEntry.name), month: Number(mEntry.name) })
    }
  }
  return out.sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

// ─── entry point ──────────────────────────────────────────────────────────
const filter = process.argv[2] // 'YYYY-MM' or undefined
const all = await discoverMonths()
const months = filter
  ? all.filter((m) => `${m.year}-${String(m.month).padStart(2, '0')}` === filter)
  : all

if (!months.length) {
  console.error(filter ? `No data dir for ${filter}` : `No data found in ${DATA_ROOT}`)
  process.exit(1)
}

console.log(`Processing ${months.length} month(s)…`)
for (const { year, month } of months) {
  await processMonth(year, month)
}
console.log('Done.')
