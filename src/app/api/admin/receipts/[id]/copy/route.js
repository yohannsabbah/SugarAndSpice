import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { createReceiptCopy, getReceipt } from '@/lib/db/receipts'

export const dynamic = 'force-dynamic'

// The Duplicate button: one photo shows two receipts, so the owner adds a
// second row on the same photo and fills it in.
export async function POST(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    const row = await getReceipt(id)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ receipt: await createReceiptCopy(row) })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
