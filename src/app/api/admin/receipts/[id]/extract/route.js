import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { getReceipt } from '@/lib/db/receipts'
import { processReceipt } from '@/lib/receipts/processReceipt'

export const dynamic = 'force-dynamic'

// The Retry button on a pending or error row: reads the photo with Claude now.
export async function POST(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    if (!(await getReceipt(id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const result = await processReceipt(id)
    return NextResponse.json({ ...result, receipt: await getReceipt(id) })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
