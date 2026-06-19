import { listExpenses, listPaymentMethods, EXPENSE_CATEGORIES, CATEGORY_LABEL } from '@/lib/db/expenses'
import UploadCard from './UploadCard'
import ManualEntryCard from './ManualEntryCard'
import ExpensesTable from './ExpensesTable'
import '../wolt/wolt.css'
import './expenses.css'

export const dynamic = 'force-dynamic'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`

function monthLabelOf(month) {
  return new Date(`${month}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}

export default async function ExpensesPage({ searchParams }) {
  const sp = await searchParams
  const monthParam = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null

  let expenses, paymentMethods
  try {
    [expenses, paymentMethods] = await Promise.all([
      listExpenses({ month: monthParam || undefined }),
      listPaymentMethods(),
    ])
  } catch (err) {
    if (err.missingSchema) return <SchemaMissingState />
    return <ErrorState error={err} />
  }

  // If no month filter, group by month for display. Otherwise just the selected month.
  const selectedMonth = monthParam
  const monthLabel = selectedMonth ? monthLabelOf(selectedMonth) : 'All months'

  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const businessTotal = expenses.filter((e) => e.is_business).reduce((s, e) => s + Number(e.amount || 0), 0)
  const businessCount = expenses.filter((e) => e.is_business).length

  // Category breakdown for the selected month (or all)
  const byCat = new Map()
  for (const e of expenses) {
    if (!e.is_business) continue
    const cat = e.category || 'other'
    byCat.set(cat, (byCat.get(cat) || 0) + Number(e.amount || 0))
  }
  const categoryRows = [...byCat.entries()]
    .map(([category, amount]) => ({ category, amount, share: businessTotal ? amount / businessTotal : 0 }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Expenses — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {expenses.length} row{expenses.length === 1 ? '' : 's'} · {paymentMethods.length} payment method{paymentMethods.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="kpi-row">
        <KPI label="Business expenses" value={ILS.format(businessTotal)}
          subtitle={`${businessCount} row${businessCount === 1 ? '' : 's'}`} />
        <KPI label="Avg / transaction"
          value={businessCount ? ILSp.format(businessTotal / businessCount) : '—'} />
        <KPI label="Top category"
          value={categoryRows[0] ? CATEGORY_LABEL[categoryRows[0].category] : '—'}
          subtitle={categoryRows[0] ? `${ILS.format(categoryRows[0].amount)} (${PCT(categoryRows[0].share)})` : null} />
        <KPI label="Excluded (personal)"
          value={ILS.format(total - businessTotal)}
          subtitle={total - businessTotal > 0 ? 'Not in P&L' : null} />
      </div>

      {/* ── Categories breakdown ──────────────────────────────────────────── */}
      {categoryRows.length > 0 && (
        <div className="card">
          <h2 className="section-h2">By category</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Share</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((c) => (
                <tr key={c.category}>
                  <td style={{ fontWeight: 600 }}>{CATEGORY_LABEL[c.category] || c.category}</td>
                  <td className="num">{ILS.format(c.amount)}</td>
                  <td className="num">{PCT(c.share)}</td>
                  <td className="expenses-bar-cell">
                    <div className="expenses-bar" style={{ width: `${c.share * 100}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Transactions table (editable category, business flag) ────────── */}
      <div className="card">
        <h2 className="section-h2">Transactions</h2>
        {expenses.length ? (
          <ExpensesTable
            initial={expenses}
            categories={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        ) : (
          <p className="muted">No expenses yet for this period.</p>
        )}
      </div>

      {/* ── Upload + manual entry ─────────────────────────────────────────── */}
      <div className="grid-2">
        <UploadCard />
        <ManualEntryCard
          categories={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          paymentMethods={paymentMethods}
        />
      </div>
    </div>
  )
}

function KPI({ label, value, subtitle }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
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
