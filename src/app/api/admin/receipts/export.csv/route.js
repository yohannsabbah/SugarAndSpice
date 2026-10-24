import { isAdmin } from '@/lib/admin'
import { listReceiptsForMonth } from '@/lib/db/receipts'
import { receiptsCsv } from '@/lib/receipts/exportFormat'

export const dynamic = 'force-dynamic'

// GET /api/admin/receipts/export.csv?month=YYYY-MM — the accountant's sheet.
export async function GET(req) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const month = new URL(req.url).searchParams.get('month')
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  try {
    const csv = receiptsCsv(await listReceiptsForMonth(month))
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="receipts-${month}.csv"`,
      },
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
