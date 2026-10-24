import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { countPendingReceipts, listReceiptsForMonth } from '@/lib/db/receipts'
import { currentIsraelMonth } from '@/lib/receipts/month'
import { summarizeReceipts } from '@/lib/receipts/money'
import { s3Bucket, s3Client } from '@/lib/s3'
import ReceiptsTable from './ReceiptsTable'
import PendingSweeper from './PendingSweeper'
import '../wolt/wolt.css'
import './receipts.css'

export const dynamic = 'force-dynamic'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function monthLabelOf(month) {
  return new Date(`${month}-01T12:00:00`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}

// Photos are private in S3. Each page load signs a short-lived link per photo.
async function withImageUrls(rows) {
  const client = s3Client()
  const Bucket = s3Bucket()
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      imageUrl: await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: r.s3_key }), { expiresIn: 3600 }),
    })),
  )
}

export default async function ReceiptsPage({ searchParams }) {
  const sp = await searchParams
  const month = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentIsraelMonth()

  let rows, pendingCount
  try {
    ;[rows, pendingCount] = await Promise.all([withImageUrls(await listReceiptsForMonth(month)), countPendingReceipts()])
  } catch (err) {
    return (
      <div className="insight bad">
        <div className="insight-title">Could not load receipts</div>
        <div className="insight-body">{err.message}</div>
      </div>
    )
  }

  const summary = summarizeReceipts(rows)
  const q = `?month=${month}`

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row receipts-head">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Receipts — {monthLabelOf(month)}</h1>
          <div className="muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>
            {summary.count} receipt{summary.count === 1 ? '' : 's'} · {ILS.format(summary.total)} · VAT {ILS.format(summary.vat)}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href={`/api/admin/receipts/export.csv${q}`}>Download CSV</a>
          <a className="btn btn-primary" href={`/api/admin/receipts/export.zip${q}`}>Download ZIP</a>
        </div>
      </div>

      <PendingSweeper pendingCount={pendingCount} />

      {rows.length === 0 ? (
        <div className="card muted">No receipts this month.</div>
      ) : (
        <ReceiptsTable key={`${month}-${pendingCount}`} initial={rows} />
      )}
    </div>
  )
}
