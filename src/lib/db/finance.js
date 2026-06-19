import 'server-only'
import { supabase } from '@/lib/supabase'
import { inferCategory } from './wolt.js'
import { getMonthlyExpenseSummaries } from './expenses.js'

// ─────────────────────────────────────────────────────────────────────────────
// Combined finance helpers — pull income from BOTH channels (Wolt + Nayax)
// and merge through the shared `items` catalog so categories line up.
//
// Wolt periods are half-month invoices, so we always roll them up to a calendar
// month before mixing with the Nayax monthly rows.
// ─────────────────────────────────────────────────────────────────────────────

// Roll Wolt half-month periods into 'YYYY-MM' calendar buckets.
function rollupWoltToMonth(periods) {
  const by = new Map()
  for (const p of periods) {
    const key = p.period_start.slice(0, 7)
    const m = by.get(key) || {
      month: key,
      gross: 0,
      net_sales: 0,
      net_payout: 0,
      orders: 0,
      fees: 0,
    }
    m.gross      += Number(p.gross_sales_incl_vat || 0)
    m.net_sales  += Number(p.net_sales_incl_vat || p.gross_sales_incl_vat || 0)
    m.net_payout += Number(p.net_payout || 0)
    m.orders     += Number(p.orders_delivered || 0)
    m.fees       += Number(p.wolt_fees_incl_vat || 0)
    by.set(key, m)
  }
  return by
}

// Returns one entry per month that has data in EITHER channel, sorted ascending.
// {
//   month: 'YYYY-MM',
//   wolt: { gross, net_sales, net_payout, orders, fees } | null,
//   instore: { gross, net, orders } | null,
//   total_gross, total_net_to_business
// }
//
// total_net_to_business = Nayax net + Wolt net_payout
// (Wolt net_payout is already after fees + withholding, which is what actually
// hits the bank. We could use Wolt net_sales instead if you want pre-fees.)
export async function getMonthlyIncomeSummaries() {
  const [{ data: wolt, error: e1 }, { data: nayax, error: e2 }] = await Promise.all([
    supabase
      .from('wolt_periods')
      .select('period_start, gross_sales_incl_vat, net_sales_incl_vat, net_payout, wolt_fees_incl_vat, refunds_incl_vat'),
    supabase
      .from('nayax_periods')
      .select('period_month, gross_incl_vat, net_incl_vat, total_orders, refunds_incl_vat'),
  ])
  if (e1) throw e1
  if (e2) throw e2

  // Wolt orders_delivered isn't on wolt_periods; pull from wolt_orders.
  const { data: woltOrders } = await supabase
    .from('wolt_orders')
    .select('period_id, status, wolt_periods(period_start)')
    .eq('status', 'delivered')

  // Count delivered orders per Wolt period_id → period_start month.
  const woltOrdersByMonth = new Map()
  for (const r of woltOrders || []) {
    const month = r.wolt_periods?.period_start?.slice(0, 7)
    if (!month) continue
    woltOrdersByMonth.set(month, (woltOrdersByMonth.get(month) || 0) + 1)
  }

  const woltMonths = rollupWoltToMonth(wolt || [])
  for (const [k, v] of woltMonths) {
    v.orders = woltOrdersByMonth.get(k) || 0
  }

  // Index Nayax by month.
  const nayaxByMonth = new Map()
  for (const n of nayax || []) {
    const key = n.period_month.slice(0, 7)
    nayaxByMonth.set(key, {
      gross: Number(n.gross_incl_vat || 0),
      net: Number(n.net_incl_vat || 0),
      orders: Number(n.total_orders || 0),
      refunds: Number(n.refunds_incl_vat || 0),
    })
  }

  // Union of all months present in either channel.
  const allMonths = new Set([...woltMonths.keys(), ...nayaxByMonth.keys()])
  const rows = [...allMonths].sort().map((month) => {
    const w = woltMonths.get(month) || null
    const i = nayaxByMonth.get(month) || null
    const wNet = w?.net_payout || 0
    const iNet = i?.net || 0
    const wGross = w?.gross || 0
    const iGross = i?.gross || 0
    return {
      month,
      wolt: w,
      instore: i,
      total_gross: wGross + iGross,
      total_net: wNet + iNet,
    }
  })

  return rows
}

// Returns categories merged across both channels for a given calendar month.
// monthStart: 'YYYY-MM-01'
// Result rows: { category, wolt_revenue, wolt_units, instore_revenue, instore_units, total_revenue, total_units }
export async function getCombinedCategoryBreakdown(monthStart) {
  const [{ data: wolt, error: e1 }, { data: nayax, error: e2 }] = await Promise.all([
    supabase
      .from('wolt_period_items')
      .select('units_sold, revenue_incl_vat, item_name, items(category)')
      .eq('month_start', monthStart),
    // Join nayax_period_items → nayax_periods to filter by period_month
    supabase
      .from('nayax_period_items')
      .select('units_sold, revenue_incl_vat, item_name, items(category), nayax_periods!inner(period_month)')
      .eq('nayax_periods.period_month', monthStart),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const byCat = new Map()
  const bump = (cat, channel, units, revenue) => {
    const e = byCat.get(cat) || {
      category: cat,
      wolt_units: 0, wolt_revenue: 0,
      instore_units: 0, instore_revenue: 0,
      total_units: 0, total_revenue: 0,
    }
    e[`${channel}_units`] += units
    e[`${channel}_revenue`] += revenue
    e.total_units += units
    e.total_revenue += revenue
    byCat.set(cat, e)
  }

  for (const r of wolt || []) {
    const cat = r.items?.category || inferCategory(r.item_name) || 'other'
    bump(cat, 'wolt', Number(r.units_sold || 0), Number(r.revenue_incl_vat || 0))
  }
  for (const r of nayax || []) {
    const cat = r.items?.category || inferCategory(r.item_name) || 'other'
    bump(cat, 'instore', Number(r.units_sold || 0), Number(r.revenue_incl_vat || 0))
  }

  return [...byCat.values()].sort((a, b) => b.total_revenue - a.total_revenue)
}

// Top items combined across both channels for a given month.
// Merges on item_id when present, else falls back to lowercased item_name.
export async function getCombinedTopItems(monthStart, limit = 25) {
  const [{ data: wolt, error: e1 }, { data: nayax, error: e2 }] = await Promise.all([
    supabase
      .from('wolt_period_items')
      .select('item_id, item_name, merchant_sku, units_sold, revenue_incl_vat, items(category)')
      .eq('month_start', monthStart),
    supabase
      .from('nayax_period_items')
      .select('item_id, item_name, merchant_sku, units_sold, revenue_incl_vat, items(category), nayax_periods!inner(period_month)')
      .eq('nayax_periods.period_month', monthStart),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const byKey = new Map()
  const keyOf = (r) => r.item_id || `name:${(r.item_name || '').trim().toLowerCase()}`
  const bump = (r, channel) => {
    const k = keyOf(r)
    const e = byKey.get(k) || {
      item_name: r.item_name,
      category: r.items?.category || null,
      wolt_units: 0, wolt_revenue: 0,
      instore_units: 0, instore_revenue: 0,
      total_units: 0, total_revenue: 0,
    }
    if (!e.category && r.items?.category) e.category = r.items.category
    e[`${channel}_units`]   += Number(r.units_sold || 0)
    e[`${channel}_revenue`] += Number(r.revenue_incl_vat || 0)
    e.total_units   += Number(r.units_sold || 0)
    e.total_revenue += Number(r.revenue_incl_vat || 0)
    byKey.set(k, e)
  }

  for (const r of wolt || []) bump(r, 'wolt')
  for (const r of nayax || []) bump(r, 'instore')

  return [...byKey.values()]
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L: Income (from getMonthlyIncomeSummaries) merged with expenses by month.
// Returns: [{ month, income_gross, income_net, expenses_total,
//             expenses_by_category, profit, margin }]
// ─────────────────────────────────────────────────────────────────────────────
export async function getMonthlyPnL() {
  const [income, expenses] = await Promise.all([
    getMonthlyIncomeSummaries(),
    getMonthlyExpenseSummaries().catch((e) => {
      // Expense tables may not exist yet on a fresh install — degrade gracefully.
      if (e.missingSchema) return []
      throw e
    }),
  ])

  const expByMonth = new Map(expenses.map((e) => [e.month, e]))
  const incByMonth = new Map(income.map((i) => [i.month, i]))
  const allMonths = new Set([...expByMonth.keys(), ...incByMonth.keys()])

  return [...allMonths].sort().map((month) => {
    const i = incByMonth.get(month)
    const e = expByMonth.get(month)
    const income_gross = i ? Number(i.total_gross || 0) : 0
    const income_net   = i ? Number(i.total_net   || 0) : 0
    const expenses_total = e ? Number(e.total || 0) : 0
    const profit = income_net - expenses_total
    return {
      month,
      income_gross,
      income_net,
      expenses_total,
      expenses_by_category: e?.by_category || {},
      profit,
      margin: income_net > 0 ? profit / income_net : null,
    }
  })
}

