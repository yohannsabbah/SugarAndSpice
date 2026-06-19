import 'server-only'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Categorize item names (Hebrew + English) for the items catalog.
// Heuristic; can be edited per-item later via the UI.
// ─────────────────────────────────────────────────────────────────────────────
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

export function inferCategory(name) {
  if (!name) return 'other'
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// documents
// ─────────────────────────────────────────────────────────────────────────────
export async function insertDocument(doc) {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      file_path: doc.file_path,
      file_name: doc.file_name,
      source: doc.source,
      doc_type: doc.doc_type,
      period_start: doc.period_start || null,
      period_end: doc.period_end || null,
      parse_status: 'parsed',
      parsed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ─────────────────────────────────────────────────────────────────────────────
// wolt_periods — upsert by (period_year, period_num). Non-null fields merge in.
// ─────────────────────────────────────────────────────────────────────────────
export async function upsertWoltPeriod(period) {
  // Try to find existing
  const { data: existing } = await supabase
    .from('wolt_periods')
    .select('*')
    .eq('period_year', period.period_year)
    .eq('period_num', period.period_num)
    .maybeSingle()

  const merged = mergeNonNull(existing || {}, period)
  // Compute net_sales_incl_vat if gross + refunds known
  if (merged.gross_sales_incl_vat != null) {
    merged.net_sales_incl_vat =
      merged.gross_sales_incl_vat - (merged.refunds_incl_vat || 0)
  }
  merged.updated_at = new Date().toISOString()

  if (existing) {
    const { error } = await supabase
      .from('wolt_periods')
      .update(merged)
      .eq('id', existing.id)
    if (error) throw error
    return existing.id
  } else {
    const { data, error } = await supabase
      .from('wolt_periods')
      .insert(merged)
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }
}

function mergeNonNull(base, incoming) {
  const out = { ...base }
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// wolt_period_fees, wolt_deductions — replace-all per period (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
export async function replaceWoltPeriodFees(periodId, fees) {
  await supabase.from('wolt_period_fees').delete().eq('period_id', periodId)
  if (!fees.length) return
  const rows = fees.map((f) => ({ period_id: periodId, ...f }))
  const { error } = await supabase.from('wolt_period_fees').insert(rows)
  if (error) throw error
}

export async function replaceWoltDeductions(periodId, deductions) {
  await supabase.from('wolt_deductions').delete().eq('period_id', periodId)
  if (!deductions.length) return
  const rows = deductions.map((d) => ({ period_id: periodId, ...d }))
  const { error } = await supabase.from('wolt_deductions').insert(rows)
  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// items — upsert by merchant_sku (when present), else by display_name
// ─────────────────────────────────────────────────────────────────────────────
const itemCache = new Map() // key -> id
export async function upsertItem({ merchant_sku, display_name }) {
  const key = merchant_sku ? `sku:${merchant_sku}` : `name:${display_name}`
  if (itemCache.has(key)) return itemCache.get(key)

  let query = supabase.from('items').select('id')
  if (merchant_sku) query = query.eq('merchant_sku', merchant_sku)
  else query = query.eq('display_name', display_name).is('merchant_sku', null)

  const { data: existing } = await query.maybeSingle()
  if (existing) {
    itemCache.set(key, existing.id)
    return existing.id
  }

  const { data, error } = await supabase
    .from('items')
    .insert({
      merchant_sku: merchant_sku || null,
      display_name,
      category: inferCategory(display_name),
    })
    .select('id')
    .single()
  if (error) throw error
  itemCache.set(key, data.id)
  return data.id
}

// ─────────────────────────────────────────────────────────────────────────────
// wolt_orders — replace all orders for a period (idempotent re-runs).
// Children (wolt_order_items) cascade-delete via FK.
// ─────────────────────────────────────────────────────────────────────────────
export async function replaceWoltOrders(periodId, orders) {
  await supabase.from('wolt_orders').delete().eq('period_id', periodId)
  if (!orders.length) return []

  // Strip the embedded `items` field before inserting the order rows
  const rows = orders.map(({ items: _, ...rest }) => ({
    period_id: periodId,
    ...rest,
  }))
  const { data, error } = await supabase
    .from('wolt_orders')
    .insert(rows)
    .select('id, order_no_public')
  if (error) throw error
  return data
}

export async function insertWoltOrderItems(orderId, items) {
  if (!items.length) return
  // Resolve item_id for each line (creates items as needed)
  const enriched = []
  for (const it of items) {
    const itemId = await upsertItem({
      merchant_sku: null, // CSV purchases don't include SKU
      display_name: it.item_name,
    })
    enriched.push({
      order_id: orderId,
      item_id: itemId,
      item_name: it.item_name,
      merchant_sku: null,
      quantity: it.quantity,
      unit_price_incl_vat: it.unit_price_incl_vat,
      line_total_incl_vat: it.line_total_incl_vat,
    })
  }
  const { error } = await supabase.from('wolt_order_items').insert(enriched)
  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// wolt_period_items — monthly items CSV. Replace-all per month.
// ─────────────────────────────────────────────────────────────────────────────
export async function replaceWoltPeriodItems(monthStart, items) {
  await supabase.from('wolt_period_items').delete().eq('month_start', monthStart)
  if (!items.length) return

  const rows = []
  for (const it of items) {
    const itemId = await upsertItem({
      merchant_sku: it.merchant_sku,
      display_name: it.item_name,
    })
    rows.push({
      month_start: monthStart,
      item_id: itemId,
      item_name: it.item_name,
      merchant_sku: it.merchant_sku,
      units_sold: it.units_sold,
      revenue_incl_vat: it.revenue_incl_vat,
    })
  }
  const { error } = await supabase.from('wolt_period_items').insert(rows)
  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers (used by the dashboard later)
// ─────────────────────────────────────────────────────────────────────────────
export async function listWoltPeriods() {
  const { data, error } = await supabase
    .from('wolt_periods')
    .select('*')
    .order('period_start', { ascending: false })
  if (error) throw error
  return data
}

export async function getWoltPeriodWithFees(periodId) {
  const { data: period, error: e1 } = await supabase
    .from('wolt_periods')
    .select('*')
    .eq('id', periodId)
    .single()
  if (e1) throw e1
  const { data: fees, error: e2 } = await supabase
    .from('wolt_period_fees')
    .select('*')
    .eq('period_id', periodId)
  if (e2) throw e2
  return { period, fees }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers for the Wolt insights dashboard
// ─────────────────────────────────────────────────────────────────────────────
export async function getWoltPeriodSummaries() {
  // For each period: the period row + fee aggregates by category +
  // order counts by channel/status + Wolt+ order count
  const [{ data: periods, error: e1 }, { data: fees, error: e2 }, { data: orders, error: e3 }] =
    await Promise.all([
      supabase.from('wolt_periods').select('*').order('period_start'),
      supabase.from('wolt_period_fees').select('period_id, fee_category, amount_incl_vat, units, campaign_id'),
      supabase.from('wolt_orders').select('period_id, channel, status, price_incl_vat, review_score'),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3

  return periods.map((p) => {
    const myFees = fees.filter((f) => f.period_id === p.id)
    const myOrders = orders.filter((o) => o.period_id === p.id)
    const byCat = (cat) => myFees
      .filter((f) => f.fee_category === cat)
      .reduce((s, f) => s + Number(f.amount_incl_vat || 0), 0)
    const woltPlusUnits = myFees
      .filter((f) => f.fee_category === 'per_order_woltplus')
      .reduce((s, f) => s + (f.units || 0), 0)

    const delivered = myOrders.filter((o) => o.status === 'delivered')
    const rejected = myOrders.filter((o) => o.status === 'rejected').length
    const pickup = myOrders.filter((o) => o.channel === 'pickup').length
    const delivery = myOrders.filter((o) => o.channel === 'delivery').length
    const revenue = delivered.reduce((s, o) => s + Number(o.price_incl_vat || 0), 0)
    const aov = delivered.length ? revenue / delivered.length : 0
    const lowReviews = myOrders.filter((o) => o.review_score != null && o.review_score <= 2).length

    return {
      ...p,
      fees_commissions: byCat('commission_pickup') + byCat('commission_delivery') + byCat('commission_delivery_woltplus') + byCat('commission_addons'),
      fees_ads: byCat('ad_campaign'),
      fees_per_order_wp: byCat('per_order_woltplus'),
      fees_other: byCat('vat_adjustment') + byCat('missing_item') + byCat('other'),
      wolt_plus_orders: woltPlusUnits,
      orders_total: myOrders.length,
      orders_delivered: delivered.length,
      orders_rejected: rejected,
      orders_pickup: pickup,
      orders_delivery: delivery,
      aov,
      low_reviews: lowReviews,
    }
  })
}

export async function getTopItemsByMonth(monthStart, limit = 10) {
  const { data, error } = await supabase
    .from('wolt_period_items')
    .select('item_name, merchant_sku, units_sold, revenue_incl_vat, items(category)')
    .eq('month_start', monthStart)
    .order('units_sold', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data.map((r) => ({ ...r, category: r.items?.category || null }))
}

export async function getCategorySalesByMonth(monthStart) {
  // Sum revenue per category, joining wolt_period_items to items.
  const { data, error } = await supabase
    .from('wolt_period_items')
    .select('units_sold, revenue_incl_vat, items(category)')
    .eq('month_start', monthStart)
  if (error) throw error
  const byCat = new Map()
  for (const r of data) {
    const cat = r.items?.category || 'other'
    const e = byCat.get(cat) || { category: cat, units: 0, revenue: 0 }
    e.units += r.units_sold
    e.revenue += Number(r.revenue_incl_vat || 0)
    byCat.set(cat, e)
  }
  return [...byCat.values()].sort((a, b) => b.revenue - a.revenue)
}

export async function getLastIpadDeduction() {
  // Find the iPad lease row with the smallest remaining_after_payment.
  const { data, error } = await supabase
    .from('wolt_deductions')
    .select('item_description, installment_num, remaining_after_payment, installment_amount, period_id')
    .order('installment_num', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

export async function getRecentLowReviews(limit = 6) {
  const { data, error } = await supabase
    .from('wolt_orders')
    .select('order_no_public, placed_at, price_incl_vat, review_score, review_comment, review_attributions')
    .not('review_score', 'is', null)
    .lte('review_score', 3)
    .order('placed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getReviewBreakdownByMonth(monthStartISO, monthEndExclusiveISO) {
  // Count orders with review scores in [monthStart, monthEndExclusive)
  // and bucket by score 1..5.
  const { data, error } = await supabase
    .from('wolt_orders')
    .select('review_score, review_attributions')
    .gte('placed_at', monthStartISO)
    .lt('placed_at', monthEndExclusiveISO)
    .not('review_score', 'is', null)
  if (error) throw error

  const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const tagCounts = new Map()
  let total = 0
  let sum = 0
  for (const row of data) {
    const s = Number(row.review_score)
    if (s >= 1 && s <= 5) {
      buckets[s] += 1
      total += 1
      sum += s
    }
    for (const tag of row.review_attributions || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }
  return {
    total,
    avg: total ? sum / total : 0,
    distribution: buckets,
    topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  }
}
