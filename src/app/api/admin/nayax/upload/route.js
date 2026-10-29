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
  if (!hourlyFile && !itemsFile && !paymentsFile) {
    return NextResponse.json({ error: 'Choose at least one file: hourly, items or payments' }, { status: 400 })
  }

  // Each file is optional. A file replaces only its own part of the month, so
  // one report can be uploaded again without the other two.
  let hourly = null, items = null, payments = null
  try {
    const [hourlyCsv, itemsCsv, paymentsCsv] = await Promise.all([
      hourlyFile?.text(),
      itemsFile?.text(),
      paymentsFile?.text(),
    ])
    if (hourlyCsv != null) hourly = parseHourly(hourlyCsv)
    if (itemsCsv != null) items = parseItems(itemsCsv)
    if (paymentsCsv != null) payments = parsePayments(paymentsCsv)
  } catch (e) {
    return NextResponse.json({ error: 'Could not read files: ' + e.message }, { status: 400 })
  }

  // Reconciliation checks — non-blocking, returned to the UI for display.
  // A check runs only when both of its files are in this upload.
  const checks = []
  if (hourly && payments) {
    checks.push(
      {
        label: 'Hourly orders match payments total',
        a: hourly.hours.reduce((s, h) => s + h.orders, 0),
        b: payments.totals?.orders ?? null,
      },
      {
        label: 'Hourly revenue matches payments gross',
        a: round2(hourly.hours.reduce((s, h) => s + h.revenue, 0)),
        b: round2(payments.totals?.gross_incl_vat ?? 0),
      },
    )
  }
  if (items && payments) {
    checks.push({
      label: 'Items revenue matches payments net',
      a: round2(items.items.reduce((s, i) => s + i.revenue_incl_vat, 0)),
      b: round2(payments.totals?.net_incl_vat ?? 0),
    })
  }
  for (const c of checks) c.ok = c.a === c.b

  // Hard-fail checks: parsers must've found *something* in each file sent.
  if (hourly && !hourly.hours.length) {
    return NextResponse.json({ error: 'hourly.csv parsed to 0 rows — wrong file?', checks }, { status: 400 })
  }
  if (items && !items.items.length) {
    return NextResponse.json({ error: 'items.csv parsed to 0 items — wrong file?', checks }, { status: 400 })
  }
  if (payments && !payments.totals) {
    return NextResponse.json({ error: 'payments.csv had no grand-total row — wrong file?', checks }, { status: 400 })
  }

  // Insert (idempotent — re-uploading a file overwrites its part of the month).
  const periodMonth = `${month}-01`
  const totals = payments?.totals
  let periodId
  try {
    periodId = await upsertNayaxPeriod({
      period_month: periodMonth,
      ...(totals && {
        gross_incl_vat: totals.gross_incl_vat,
        refunds_incl_vat: totals.refunds_incl_vat,
        net_incl_vat: totals.net_incl_vat,
        total_orders: totals.orders,
        refund_count: totals.refund_count,
      }),
      ...(items && { units_sold: items.grand_total?.units_sold ?? null }),
    })
    await Promise.all([
      hourly && replaceNayaxPeriodHours(periodId, hourly.hours),
      payments && replaceNayaxPeriodPayments(periodId, payments.methods),
      items && replaceNayaxPeriodItems(periodId, items.items),
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
      orders: totals?.orders ?? null,
      gross: totals?.gross_incl_vat ?? null,
      net: totals?.net_incl_vat ?? null,
      items: items ? items.items.length : null,
      hours: hourly ? hourly.hours.length : null,
      methods: payments ? payments.methods.length : null,
    },
    checks,
  })
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
