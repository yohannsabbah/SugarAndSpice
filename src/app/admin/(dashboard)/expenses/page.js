import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { listExpenses, EXPENSE_CATEGORIES, CATEGORY_LABEL } from '@/lib/db/expenses'
import { getRecurringExpenses } from '@/lib/db/recurringExpenses'
import { countPendingReceipts, listReceiptsForMonth } from '@/lib/db/receipts'
import { listEmployees } from '@/lib/db/employees'
import { currentIsraelMonth } from '@/lib/receipts/month'
import { s3Bucket, s3Client } from '@/lib/s3'
import ReceiptsTable from './ReceiptsTable'
import PendingSweeper from './PendingSweeper'
import AddExpenseCard from './AddExpenseCard'
import ExpensesTable from './ExpensesTable'
import UploadCard from './UploadCard'
import '../wolt/wolt.css'
import './expenses.css'
import './receipts.css'

export const dynamic = 'force-dynamic'

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

// One page for every expense: receipt photos first, then hand-entered and
// recurring expenses, then card charges from the MAX statement.
export default async function ExpensesPage({ searchParams }) {
  const sp = await searchParams
  const month = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentIsraelMonth()

  let receipts, pendingCount, employees, expenses, recurring
  try {
    ;[receipts, pendingCount, employees, expenses, recurring] = await Promise.all([
      listReceiptsForMonth(month).then(withImageUrls),
      countPendingReceipts(),
      listEmployees({ includeInactive: true }),
      listExpenses({ month }),
      getRecurringExpenses(),
    ])
  } catch (err) {
    if (err.missingSchema) return <SchemaMissingState />
    return <ErrorState error={err} />
  }

  const q = `?month=${month}`
  const categories = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row receipts-head">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Expenses — {monthLabelOf(month)}</h1>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href={`/api/admin/receipts/export.csv${q}`}>Receipts CSV</a>
          <a className="btn btn-primary" href={`/api/admin/receipts/export.zip${q}`}>Receipts ZIP</a>
        </div>
      </div>

      {/* Without these keys processReceipt skips every photo and rows stay pending. */}
      {!(process.env.BEDROCK_AWS_ACCESS_KEY_ID && process.env.BEDROCK_AWS_SECRET_ACCESS_KEY) && (
        <div className="insight bad">
          <div className="insight-title">Receipts cannot be read</div>
          <div className="insight-body">
            The server has no Bedrock keys. Add BEDROCK_AWS_ACCESS_KEY_ID, BEDROCK_AWS_SECRET_ACCESS_KEY and
            BEDROCK_AWS_REGION in Amplify (Hosting → Environment variables), then redeploy.
          </div>
        </div>
      )}

      <PendingSweeper pendingCount={pendingCount} />

      {receipts.length === 0 ? (
        <div className="card muted">No receipts this month.</div>
      ) : (
        <ReceiptsTable key={`${month}-${pendingCount}`} initial={receipts} employees={employees.map((e) => ({ id: e.id, name: e.name }))} />
      )}

      {/* ── Hand entry (one-time or recurring) ───────────────────────────── */}
      <AddExpenseCard
        categories={categories}
        recurring={recurring.items}
        recurringTableMissing={recurring.tableMissing}
      />

      {/* ── Card charges and one-time expenses (editable category, business flag) */}
      <div className="card">
        <h2 className="section-h2">Card and manual expenses</h2>
        {expenses.length ? (
          <ExpensesTable initial={expenses} categories={categories} />
        ) : (
          <p className="muted">No card or manual expenses this month.</p>
        )}
      </div>

      <UploadCard />
    </div>
  )
}

function SchemaMissingState() {
  return (
    <div className="card">
      <h2 className="section-h2">Expense tables not created yet</h2>
      <p>The expense tables don&apos;t exist in Supabase yet. Run this once:</p>
      <ol className="muted" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
        <li>Open Supabase dashboard → SQL Editor → New query</li>
        <li>Paste <code>webapp/supabase-finance-schema.sql</code> (idempotent)</li>
        <li>Click <b>Run</b></li>
      </ol>
      <p className="muted" style={{ fontSize: '0.85rem' }}>Then reload this page.</p>
    </div>
  )
}

function ErrorState({ error }) {
  return (
    <div className="card">
      <h2 className="section-h2" style={{ color: 'var(--danger)' }}>Could not load expenses</h2>
      <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontSize: '0.8rem', overflowX: 'auto' }}>
        {JSON.stringify({ message: error?.message, code: error?.code, hint: error?.hint }, null, 2)}
      </pre>
    </div>
  )
}
