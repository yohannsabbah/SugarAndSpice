import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { updateRecurringExpense, deleteRecurringExpense } from '@/lib/db/recurringExpenses'

const YM = /^\d{4}-\d{2}$/

// PATCH /api/admin/recurring-expenses/[id] — body: { end_month: 'YYYY-MM' | null }
// Stops a recurring expense after a month (or restarts it with null).
export async function PATCH(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (body.end_month !== null && !YM.test(body.end_month || '')) {
    return NextResponse.json({ error: 'end_month must be YYYY-MM or null' }, { status: 400 })
  }
  try {
    const row = await updateRecurringExpense(id, { end_month: body.end_month ? `${body.end_month}-01` : null })
    return NextResponse.json({ ok: true, row })
  } catch (e) {
    // 23514 = check_violation: the table rejects an end month before the start month.
    if (e.code === '23514') {
      return NextResponse.json({ error: 'The last month cannot be before the start month' }, { status: 400 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/admin/recurring-expenses/[id] — removes it from every month.
export async function DELETE(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    await deleteRecurringExpense(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
