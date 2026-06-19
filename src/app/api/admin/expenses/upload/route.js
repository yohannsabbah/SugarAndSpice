import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { parseMaxXlsx } from '@/lib/parsers/expenses/parseMaxXlsx'
import {
  inferExpenseCategory,
  upsertCreditCard,
  insertExpenseDocument,
  insertExpenses,
  rowHash,
} from '@/lib/db/expenses'

// POST /api/admin/expenses/upload
//   multipart form, fields:
//     file:   .xlsx
//     source: 'max_xlsx' (only supported for now)
//
// Returns { ok, document_id, total_amount, rows: <preview>, inserted, skipped }.
export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const file = form.get('file')
  const source = String(form.get('source') || 'max_xlsx')
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (source !== 'max_xlsx') {
    return NextResponse.json({ error: `Unsupported source '${source}'` }, { status: 400 })
  }

  let buffer
  try {
    buffer = Buffer.from(await file.arrayBuffer())
  } catch (e) {
    return NextResponse.json({ error: 'Could not read file: ' + e.message }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseMaxXlsx(buffer)
  } catch (e) {
    return NextResponse.json({ error: 'Parse error: ' + e.message }, { status: 400 })
  }

  if (!parsed.rows.length) {
    return NextResponse.json({ error: 'No transaction rows found in file' }, { status: 400 })
  }

  // Reconciliation: sum of parsed rows should match the bottom-of-sheet total.
  const sum = round2(parsed.rows.reduce((s, r) => s + r.amount, 0))
  const total = round2(parsed.meta.total_amount || 0)
  const reconciled = total > 0 ? Math.abs(sum - total) < 0.5 : null

  // Map each distinct card last4 → payment_method_id (one row per real card).
  const cardLast4s = [...new Set(parsed.rows.map((r) => r.card_last4).filter(Boolean))]
  const cardToPMId = {}
  try {
    for (const last4 of cardLast4s) {
      cardToPMId[last4] = await upsertCreditCard({
        card_last4: last4,
        issuer: 'max',
        display_name: `MAX ${last4}`,
      })
    }
  } catch (e) {
    return NextResponse.json({ error: 'Could not create payment_method: ' + e.message }, { status: 500 })
  }

  // Record the document.
  let docId
  try {
    docId = await insertExpenseDocument({
      file_name: file.name || 'upload.xlsx',
      source,
      period_label: parsed.meta.period_label,
      total_amount: total || sum,
      row_count: parsed.rows.length,
      cardholder: parsed.meta.cardholder,
      raw_meta: { card_label: parsed.meta.card_label, sum_check: sum, reconciled },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Could not insert document: ' + e.message }, { status: 500 })
  }

  // Build expense rows with auto-category + dedup hash.
  const expenseRows = parsed.rows.map((r) => ({
    transaction_date:  r.transaction_date,
    billing_date:      r.billing_date,
    vendor:            r.vendor,
    vendor_normalized: r.vendor_normalized,
    amount:            r.amount,
    currency:          r.currency || 'ILS',
    amount_original:   r.amount_original,
    currency_original: r.currency_original,
    category:          inferExpenseCategory(r.vendor_normalized, r.source_category),
    source_category:   r.source_category,
    is_business:       true,
    payment_method_id: r.card_last4 ? cardToPMId[r.card_last4] : null,
    transaction_type:  r.transaction_type,
    source_doc_id:     docId,
    source_row_hash:   rowHash({
      transaction_date: r.transaction_date,
      vendor: r.vendor,
      amount: r.amount,
      card_last4: r.card_last4,
    }),
    notes:             r.notes,
  }))

  let inserted, skipped
  try {
    ;({ inserted, skipped } = await insertExpenses(expenseRows))
  } catch (e) {
    return NextResponse.json({ error: 'Could not insert expenses: ' + e.message, hint: e.hint || e.code || null }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    document_id: docId,
    period_label: parsed.meta.period_label,
    cardholder: parsed.meta.cardholder,
    total_amount: total || sum,
    parsed_sum: sum,
    reconciled,
    row_count: parsed.rows.length,
    inserted,
    skipped,
    cards: cardLast4s,
  })
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }
