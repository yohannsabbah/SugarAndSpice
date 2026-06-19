import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { updateExpense, deleteExpense, EXPENSE_CATEGORIES } from '@/lib/db/expenses'

// PATCH /api/admin/expenses/[id] — edit category, is_business flag, notes, etc.
export async function PATCH(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  if (body.category && !EXPENSE_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `Bad category: ${body.category}` }, { status: 400 })
  }
  try {
    await updateExpense(id, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/admin/expenses/[id] — used by the manual-entry undo path.
export async function DELETE(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    await deleteExpense(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
