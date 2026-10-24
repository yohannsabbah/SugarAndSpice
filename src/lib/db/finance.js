import 'server-only'
import { supabase } from '@/lib/supabase'
import { inferCategory } from './wolt.js'
import { getMonthlyExpenseSummaries } from './expenses.js'
import { getReceiptsByMonth } from './receipts.js'
import { hourlyRateFor, isJenny } from '@/lib/payroll'
import { EXPENSE_VAT_RATE, VAT_RATE, withoutVat } from '@/lib/vat'
import { shiftDurationMs } from '@/lib/format'

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


// ─────────────────────────────────────────────────────────────────────────────
// Shift pay per 'YYYY-MM' (Israel time), using the same rates as the Shifts tab.
// Jenny is left out, the same as the Shifts tab's total to pay.
const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })

async function getMonthlyShiftPay() {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('shifts')
      .select('started_at, ended_at, employees(name)')
      .order('started_at')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) break
  }

  const by = new Map()
  for (const s of rows) {
    const name = s.employees?.name
    if (isJenny(name)) continue
    const month = ISRAEL_DAY.format(new Date(s.started_at)).slice(0, 7)
    const hours = shiftDurationMs(s.started_at, s.ended_at) / 3_600_000
    by.set(month, (by.get(month) || 0) + hours * hourlyRateFor(name))
  }
  return by
}

// ─────────────────────────────────────────────────────────────────────────────
// Month-by-month overview for the admin home, without VAT.
// Returns one row per month that has any data, newest first:
// {
//   month: 'YYYY-MM',
//   store, wolt, expenses: { incl, excl, vat } | null,  // wolt = sales − Wolt fees
//   expenses_receipts, // how much of `expenses` (with VAT) comes from receipt photos
//   wolt_total_sales, // Wolt "Total sales": with VAT, before fees and refunds | null
//   wolt_periods,   // Wolt half-month periods with an uploaded invoice (0-2)
//   salary,         // shift pay + 'salary' expenses (no VAT) | null
//   profit,         // without VAT
//   vat_to_pay,     // VAT on sales − reclaimable VAT on Wolt fees and expenses (info only)
// }
// A field is null when that source has no data for the month. Wolt's 5%
// withholding and its installment deductions are left out: they come off the
// payout but are not costs of the business.
// ─────────────────────────────────────────────────────────────────────────────
function money(incl, excl) {
  return { incl, excl, vat: incl - excl }
}

function addMoney(a, b) {
  if (!a) return b
  return money(a.incl + b.incl, a.excl + b.excl)
}

export async function getMonthlyOverview() {
  const [{ data: wolt, error: e1 }, { data: nayax, error: e2 }, expenses, shiftPay, receipts] = await Promise.all([
    supabase
      .from('wolt_periods')
      .select('period_start, gross_sales_incl_vat, refunds_incl_vat, wolt_fees_incl_vat, wolt_fees_excl_vat'),
    supabase.from('nayax_periods').select('period_month, net_incl_vat'),
    getMonthlyExpenseSummaries().catch((e) => {
      if (e.missingSchema) return []
      throw e
    }),
    getMonthlyShiftPay(),
    getReceiptsByMonth(),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const by = new Map()
  const row = (month) => {
    if (!by.has(month)) {
      by.set(month, {
        month, store: null, wolt: null, wolt_total_sales: null, wolt_periods: 0, expenses: null, salary: null,
      })
    }
    return by.get(month)
  }

  for (const n of nayax || []) {
    if (n.net_incl_vat == null) continue
    const incl = Number(n.net_incl_vat)
    row(n.period_month.slice(0, 7)).store = money(incl, withoutVat(incl))
  }

  // A period row can exist before its invoice is uploaded (all amounts null).
  // Only periods with sales count as uploaded.
  for (const p of wolt || []) {
    if (p.gross_sales_incl_vat == null) continue
    const r = row(p.period_start.slice(0, 7))
    const salesIncl = Number(p.gross_sales_incl_vat) - Number(p.refunds_incl_vat || 0)
    const feesIncl = Number(p.wolt_fees_incl_vat || 0)
    const feesExcl = p.wolt_fees_excl_vat != null ? Number(p.wolt_fees_excl_vat) : withoutVat(feesIncl)
    r.wolt = addMoney(r.wolt, money(salesIncl - feesIncl, withoutVat(salesIncl) - feesExcl))
    r.wolt_total_sales = (r.wolt_total_sales || 0) + Number(p.gross_sales_incl_vat)
    r.wolt_periods += 1
  }

  // Expenses are card charges with VAT. Salary rows move to the salary column.
  for (const e of expenses) {
    let total = null
    for (const [category, amount] of Object.entries(e.by_category)) {
      if (category === 'salary') continue
      const rate = EXPENSE_VAT_RATE[category] ?? VAT_RATE
      total = addMoney(total, money(amount, withoutVat(amount, rate)))
    }
    const r = row(e.month)
    if (total) r.expenses = total
    if (e.by_category.salary) r.salary = (r.salary || 0) + e.by_category.salary
  }

  // Receipt photos are expenses too. Their categories have their own names;
  // the shared ones (meals, transport, equipment) take the expense VAT rule.
  for (const [month, list] of receipts) {
    let total = null
    for (const { total: amount, category } of list) {
      total = addMoney(total, money(amount, withoutVat(amount, EXPENSE_VAT_RATE[category] ?? VAT_RATE)))
    }
    if (!total) continue
    const r = row(month)
    r.expenses = addMoney(r.expenses, total)
    r.expenses_receipts = total.incl
  }

  for (const [month, pay] of shiftPay) {
    const r = row(month)
    r.salary = (r.salary || 0) + pay
  }

  const excl = (m) => m?.excl || 0
  const vat = (m) => m?.vat || 0
  return [...by.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((r) => ({
      ...r,
      profit: excl(r.store) + excl(r.wolt) - excl(r.expenses) - (r.salary || 0),
      vat_to_pay: vat(r.store) + vat(r.wolt) - vat(r.expenses),
    }))
}
