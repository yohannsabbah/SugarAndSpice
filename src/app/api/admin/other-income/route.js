import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { createOtherIncome, PAYMENT_METHODS } from '@/lib/db/otherIncome'

// POST /api/admin/other-income
//   body: { received_on: 'YYYY-MM-DD', description, amount, includes_vat, payment_method, notes? }
export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.received_on || '')) {
    return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 })
  }
  const description = String(body.description || '').trim()
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
  }
  if (!PAYMENT_METHODS.includes(body.payment_method)) {
    return NextResponse.json({ error: `Bad payment method: ${body.payment_method}` }, { status: 400 })
  }

  try {
    const row = await createOtherIncome({
      received_on: body.received_on,
      description,
      amount,
      includes_vat: body.includes_vat !== false,
      payment_method: body.payment_method,
      notes: body.notes ? String(body.notes).trim() : null,
    })
    return NextResponse.json({ ok: true, row })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
