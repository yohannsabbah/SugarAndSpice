import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { deleteReceipt, getReceipt, updateReceipt } from '@/lib/db/receipts'
import { VAT_RATE, vatAmount } from '@/lib/receipts/money'

export const dynamic = 'force-dynamic'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

function isRealDate(s) {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function blankToNull(v) {
  return typeof v === 'string' && v.trim() === '' ? null : v
}

// Each editable field: a validator that returns the value to store, or throws.
const FIELDS = {
  purchased_at(v) {
    if (v === null) return null
    if (typeof v === 'string' && isRealDate(v)) return v
    throw new Error('purchased_at must be YYYY-MM-DD')
  },
  purchased_time(v) {
    if (v === null) return null
    const m = typeof v === 'string' && TIME_RE.exec(v)
    if (m) return `${m[1]}:${m[2]}:${m[3] || '00'}`
    throw new Error('purchased_time must be HH:MM or HH:MM:SS')
  },
  vendor: text('vendor'),
  receipt_number: text('receipt_number'),
  notes: text('notes'),
  total(v) {
    if (v === null) return null
    const n = typeof v === 'number' ? v : NaN
    if (Number.isFinite(n) && n >= 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6) return n
    throw new Error('total must be a number of at least 0 with up to 2 decimals')
  },
  // The owner can only clear a duplicate mark; marking is the extractor's job.
  duplicate_of(v) {
    if (v === null) return null
    throw new Error('duplicate_of can only be cleared (null)')
  },
}

function text(name) {
  return (v) => {
    if (v === null) return null
    if (typeof v === 'string' && v.trim().length <= 200) return v.trim()
    throw new Error(`${name} must be text of up to 200 characters`)
  }
}

// PATCH /api/admin/receipts/[id] — the owner corrects a field. Any edit marks
// the row reviewed, so extraction never overwrites it afterwards.
export async function PATCH(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 })
  }

  const fields = {}
  try {
    for (const [key, raw] of Object.entries(body)) {
      if (!FIELDS[key]) throw new Error(`Unknown field: ${key}`)
      fields[key] = FIELDS[key](blankToNull(raw))
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }

  try {
    if (!(await getReceipt(id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if ('total' in fields) {
      fields.vat_rate = VAT_RATE
      fields.vat_amount = vatAmount(fields.total)
    }
    const receipt = await updateReceipt(id, {
      ...fields,
      parse_status: 'reviewed',
      reviewed_at: new Date().toISOString(),
    })
    return NextResponse.json({ receipt })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/admin/receipts/[id] — removes the row. The photo stays in S3.
export async function DELETE(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    if (!(await getReceipt(id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await deleteReceipt(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
