import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import {
  parseHourly,
  parsePayments,
  parseItems,
} from '@/lib/parsers/nayax'
import {
  upsertNayaxPeriod,
  replaceNayaxPeriodHours,
  replaceNayaxPeriodPayments,
  replaceNayaxPeriodItems,
} from '@/lib/db/nayax'

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const month = String(form.get('month') || '')   // 'YYYY-MM'
  const hourlyFile = form.get('hourly')
  const itemsFile = form.get('items')
  const paymentsFile = form.get('payments')

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'Bad or missing month (expected YYYY-MM)' }, { status: 400 })
  }
  if (!hourlyFile || !itemsFile || !paymentsFile) {
    return NextResponse.json({ error: 'Need all 3 files: hourly, items, payments' }, { status: 400 })
  }

  let hourlyCsv, itemsCsv, paymentsCsv
  try {
    [hourlyCsv, itemsCsv, paymentsCsv] = await Promise.all([
      hourlyFile.text(),
      itemsFile.text(),
      paymentsFile.text(),
    ])
  } catch (e) {
    return NextResponse.json({ error: 'Could not read files: ' + e.message }, { status: 400 })
  }

  let hourly, items, payments
  try {
    hourly = parseHourly(hourlyCsv)
    items = parseItems(itemsCsv)
    payments = parsePayments(paymentsCsv)
  } catch (e) {
    return NextResponse.json({ error: 'Parse error: ' + e.message }, { status: 400 })
  }

  // Reconciliation checks — non-blocking, returned to the UI for display.
  const ordersFromHours = hourly.hours.reduce((s, h) => s + h.orders, 0)
  const revenueFromHours = round2(hourly.hours.reduce((s, h) => s + h.revenue, 0))
  const itemsSum = round2(items.items.reduce((s, i) => s + i.revenue_incl_vat, 0))

  const checks = [
    {
      label: 'Hourly orders match payments total',
      a: ordersFromHours,
      b: payments.totals?.orders ?? null,
    },
    {
      label: 'Hourly revenue matches payments gross',
      a: revenueFromHours,
      b: round2(payments.totals?.gross_incl_vat ?? 0),
    },
    {
      label: 'Items revenue matches payments net',
      a: itemsSum,
      b: round2(payments.totals?.net_incl_vat ?? 0),
    },
  ].map((c) => ({ ...c, ok: c.a === c.b }))

  // Hard-fail checks: parsers must've found *something* in each file.
  if (!hourly.hours.length) {
    return NextResponse.json({ error: 'hourly.csv parsed to 0 rows — wrong file?', checks }, { status: 400 })
  }
  if (!items.items.length) {
    return NextResponse.json({ error: 'items.csv parsed to 0 items — wrong file?', checks }, { status: 400 })
  }
  if (!payments.totals) {
    return NextResponse.json({ error: 'payments.csv had no grand-total row — wrong file?', checks }, { status: 400 })
  }

  // Insert (idempotent — re-uploading the same month overwrites it).
  const periodMonth = `${month}-01`
  const totals = payments.totals
  let periodId
  try {
    periodId = await upsertNayaxPeriod({
      period_month: periodMonth,
      gross_incl_vat: totals.gross_incl_vat,
      refunds_incl_vat: totals.refunds_incl_vat,
      net_incl_vat: totals.net_incl_vat,
      total_orders: totals.orders,
      refund_count: totals.refund_count,
      units_sold: items.grand_total?.units_sold ?? null,
    })
    await Promise.all([
      replaceNayaxPeriodHours(periodId, hourly.hours),
      replaceNayaxPeriodPayments(periodId, payments.methods),
      replaceNayaxPeriodItems(periodId, items.items),
    ])
  } catch (e) {
    return NextResponse.json({
      error: 'Database write failed: ' + e.message,
      hint: e.hint || e.code || null,
      checks,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    period_id: periodId,
    period_month: periodMonth,
    summary: {
      orders: totals.orders,
      gross: totals.gross_incl_vat,
      net: totals.net_incl_vat,
      items: items.items.length,
      hours: hourly.hours.length,
      methods: payments.methods.length,
    },
    checks,
  })
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
