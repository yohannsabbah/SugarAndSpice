import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { EXPENSE_CATEGORIES } from '@/lib/db/expenses'
import { createRecurringExpense, PAYMENT_METHODS } from '@/lib/db/recurringExpenses'

const YM = /^\d{4}-\d{2}$/

// POST /api/admin/recurring-expenses
//   body: { name, category, amount, includes_vat, payment_method, start_month: 'YYYY-MM',
//           end_month?: 'YYYY-MM', notes? }
export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!EXPENSE_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `Bad category: ${body.category}` }, { status: 400 })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
  }
  if (!PAYMENT_METHODS.includes(body.payment_method)) {
    return NextResponse.json({ error: `Bad payment method: ${body.payment_method}` }, { status: 400 })
  }
  if (!YM.test(body.start_month || '')) {
    return NextResponse.json({ error: 'Start month must be YYYY-MM' }, { status: 400 })
  }
  if (body.end_month && (!YM.test(body.end_month) || body.end_month < body.start_month)) {
    return NextResponse.json({ error: 'End month must be YYYY-MM and not before the start month' }, { status: 400 })
  }

  try {
    const row = await createRecurringExpense({
      name,
      category: body.category,
      amount,
      includes_vat: body.includes_vat === true,
      payment_method: body.payment_method,
      start_month: `${body.start_month}-01`,
      end_month: body.end_month ? `${body.end_month}-01` : null,
      notes: body.notes ? String(body.notes).trim() : null,
    })
    return NextResponse.json({ ok: true, row })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
