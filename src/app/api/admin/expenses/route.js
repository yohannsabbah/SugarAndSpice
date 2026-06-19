import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { supabase } from '@/lib/supabase'
import { EXPENSE_CATEGORIES, rowHash } from '@/lib/db/expenses'

// POST /api/admin/expenses
//   body: { transaction_date, vendor, amount, category, payment_method_id?,
//           notes?, billing_date?, is_business? }
// Creates a manual expense (rent, salary, cash purchase, anything not from a
// CSV import).
export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))

  const required = ['transaction_date', 'vendor', 'amount', 'category']
  for (const k of required) {
    if (body[k] == null || body[k] === '') {
      return NextResponse.json({ error: `Missing field: ${k}` }, { status: 400 })
    }
  }
  if (!EXPENSE_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `Bad category: ${body.category}` }, { status: 400 })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  // Use a hash even for manual entries so accidentally double-submitting the
  // same form doesn't create two identical rows.
  const hash = rowHash({
    transaction_date: body.transaction_date,
    vendor: body.vendor,
    amount,
    card_last4: 'manual',
  })

  const payload = {
    transaction_date: body.transaction_date,
    billing_date: body.billing_date || body.transaction_date,
    vendor: String(body.vendor).trim(),
    vendor_normalized: String(body.vendor).trim().toLowerCase(),
    amount,
    currency: 'ILS',
    category: body.category,
    is_business: body.is_business !== false,
    payment_method_id: body.payment_method_id || null,
    transaction_type: 'manual',
    source_doc_id: null,
    source_row_hash: hash,
    notes: body.notes || null,
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select('id')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data.id })
}
