import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { countPendingReceipts, listPendingReceipts } from '@/lib/db/receipts'
import { processReceipt } from '@/lib/receipts/processReceipt'

export const dynamic = 'force-dynamic'

// One at a time, so one request stays well inside the hosting time limit even
// when a model call times out and retries. The admin page calls this again
// until nothing is left.
const BATCH = 1

// Reads receipts that are still pending: an upload whose after() read did not
// run or did not finish. Oldest first.
export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    let processed = 0
    for (const { id } of await listPendingReceipts(BATCH)) {
      const { status } = await processReceipt(id)
      if (status !== 'skipped') processed++
    }
    return NextResponse.json({ processed, remaining: await countPendingReceipts() })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
