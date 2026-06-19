import 'server-only'
import { supabase } from '@/lib/supabase'
import { upsertItem, inferCategory } from './wolt.js'

// ─────────────────────────────────────────────────────────────────────────────
// nayax_periods — upsert by period_month.
// ─────────────────────────────────────────────────────────────────────────────
export async function upsertNayaxPeriod(period) {
  // period.period_month must be 'YYYY-MM-01'
  const label = new Date(period.period_month).toLocaleString('en-IL', {
    month: 'long',
    year: 'numeric',
  })

  const payload = {
    period_month: period.period_month,
    period_label: period.period_label || label,
    gross_incl_vat: period.gross_incl_vat ?? null,
    refunds_incl_vat: period.refunds_incl_vat ?? 0,
    net_incl_vat: period.net_incl_vat ?? null,
    total_orders: period.total_orders ?? null,
    refund_count: period.refund_count ?? 0,
    units_sold: period.units_sold ?? null,
    avg_ticket: period.total_orders ? Number(period.net_incl_vat) / period.total_orders : null,
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('nayax_periods')
    .select('id')
    .eq('period_month', period.period_month)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase.from('nayax_periods').update(payload).eq('id', existing.id)
    if (error) throw error
    return existing.id
  } else {
    const { data, error } = await supabase
      .from('nayax_periods')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// replace-all helpers — idempotent re-imports
// ─────────────────────────────────────────────────────────────────────────────
export async function replaceNayaxPeriodHours(periodId, hours) {
  await supabase.from('nayax_period_hours').delete().eq('period_id', periodId)
  if (!hours.length) return
  const rows = hours.map((h) => ({
    period_id: periodId,
    hour: h.hour,
    revenue: h.revenue,
    orders: h.orders,
    avg_ticket: h.avg_ticket,
  }))
  const { error } = await supabase.from('nayax_period_hours').insert(rows)
  if (error) throw error
}

export async function replaceNayaxPeriodPayments(periodId, methods) {
  await supabase.from('nayax_period_payments').delete().eq('period_id', periodId)
  if (!methods.length) return
  const rows = methods.map((m) => ({ period_id: periodId, ...m }))
  const { error } = await supabase.from('nayax_period_payments').insert(rows)
  if (error) throw error
}

export async function replaceNayaxPeriodItems(periodId, items) {
  await supabase.from('nayax_period_items').delete().eq('period_id', periodId)
  if (!items.length) return

  // Resolve item_id for each (re-uses the shared `items` catalog).
  const rows = []
  for (const it of items) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers — used by the /admin/nayax page
// ─────────────────────────────────────────────────────────────────────────────
export async function listNayaxPeriods() {
  const { data, error } = await supabase
    .from('nayax_periods')
    .select('*')
    .order('period_month', { ascending: false })
  if (error) {
    // 42P01 = undefined_table. Surface a clearer signal so the page can show a
    // "run the SQL" message instead of crashing with a raw PostgREST blob.
    if (error.code === '42P01') {
      const err = new Error('nayax tables missing')
      err.cause = error
      err.missingSchema = true
      throw err
    }
    throw error
  }
  return data
}

export async function getNayaxPeriodByMonth(periodMonth) {
  // periodMonth: 'YYYY-MM-01'
  const { data, error } = await supabase
    .from('nayax_periods')
    .select('*')
    .eq('period_month', periodMonth)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getNayaxPeriodDetail(periodId) {
  const [hours, payments, topItems, categorySales] = await Promise.all([
    supabase
      .from('nayax_period_hours')
      .select('hour, revenue, orders, avg_ticket')
      .eq('period_id', periodId)
      .order('hour'),
    supabase
      .from('nayax_period_payments')
      .select('method, orders, gross_incl_vat, refund_count, refunds_incl_vat, net_incl_vat')
      .eq('period_id', periodId),
    supabase
      .from('nayax_period_items')
      .select('item_name, merchant_sku, raw_category, units_sold, revenue_incl_vat, avg_price_incl_vat, share_of_total, items(category)')
      .eq('period_id', periodId)
      .order('revenue_incl_vat', { ascending: false }),
    null, // computed from topItems below
  ])
  if (hours.error) throw hours.error
  if (payments.error) throw payments.error
  if (topItems.error) throw topItems.error

  // Aggregate by normalized category (joined items.category, fallback 'other').
  const byCat = new Map()
  for (const r of topItems.data) {
    const cat = r.items?.category || inferCategory(r.item_name) || 'other'
    const e = byCat.get(cat) || { category: cat, units: 0, revenue: 0 }
    e.units += r.units_sold
    e.revenue += Number(r.revenue_incl_vat || 0)
    byCat.set(cat, e)
  }
  const categories = [...byCat.values()].sort((a, b) => b.revenue - a.revenue)

  return {
    hours: hours.data || [],
    payments: payments.data || [],
    items: topItems.data || [],
    categories,
  }
}
