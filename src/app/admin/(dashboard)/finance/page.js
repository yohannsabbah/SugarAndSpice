import {
  getMonthlyIncomeSummaries,
  getCombinedCategoryBreakdown,
  getCombinedTopItems,
  getMonthlyPnL,
} from '@/lib/db/finance'
import { CATEGORY_LABEL as EXPENSE_CATEGORY_LABEL } from '@/lib/db/expenses'
import '../wolt/wolt.css'
import './finance.css'

export const dynamic = 'force-dynamic'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`

const CATEGORY_LABEL = {
  coffee_hot: 'Hot coffee',
  coffee_cold: 'Cold coffee',
  matcha: 'Matcha',
  mochi: 'Mochi',
  tea: 'Tea',
  soda: 'Soda / juice',
  cake: 'Cakes',
  pastry: 'Pastry',
  food: 'Food / bowls',
  kids: 'Kids',
  merch: 'Merch',
  other: 'Other',
}
function prettyCategory(c) { return CATEGORY_LABEL[c] || c }

function monthLabelOf(month) {
  return new Date(`${month}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function FinancePage({ searchParams }) {
  const sp = await searchParams
  const monthParam = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null

  const monthly = await getMonthlyIncomeSummaries()
  if (!monthly.length) {
    return (
      <div className="card">
        <h2 className="section-h2">No income data yet</h2>
        <p className="muted">Upload Wolt periods or in-store CSVs first, then come back here.</p>
      </div>
    )
  }

  const latest = monthly[monthly.length - 1]
  const selectedMonth = monthParam || latest.month
  const cur = monthly.find((m) => m.month === selectedMonth) || latest
  const prv = monthly.find((m) => m.month === prevMonth(selectedMonth)) || null

  const [categories, topItems, pnlAll] = await Promise.all([
    getCombinedCategoryBreakdown(`${selectedMonth}-01`),
    getCombinedTopItems(`${selectedMonth}-01`, 25),
    getMonthlyPnL(),
  ])
  const pnlCur = pnlAll.find((p) => p.month === selectedMonth) || null
  const pnlPrv = pnlAll.find((p) => p.month === prevMonth(selectedMonth)) || null

  const monthLabel = monthLabelOf(cur.month)
  const prevMonthLabel = prv ? monthLabelOf(prv.month) : monthLabelOf(prevMonth(selectedMonth))

  // ── derivations ─────────────────────────────────────────────────────────
  const curWoltGross    = cur.wolt?.gross || 0
  const curInstoreGross = cur.instore?.gross || 0
  const curTotalGross   = curWoltGross + curInstoreGross
  const curTotalNet     = (cur.wolt?.net_payout || 0) + (cur.instore?.net || 0)

  const prvWoltGross    = prv?.wolt?.gross || 0
  const prvInstoreGross = prv?.instore?.gross || 0
  const prvTotalGross   = prvWoltGross + prvInstoreGross
  const prvTotalNet     = (prv?.wolt?.net_payout || 0) + (prv?.instore?.net || 0)

  const instoreShare = curTotalGross > 0 ? curInstoreGross / curTotalGross : 0
  const woltShare    = curTotalGross > 0 ? curWoltGross    / curTotalGross : 0

  const deltaPct = (a, b) => (!b ? null : (a - b) / b)
  const dGross = deltaPct(curTotalGross, prvTotalGross)
  const dNet   = deltaPct(curTotalNet, prvTotalNet)
  const dInstore = deltaPct(curInstoreGross, prvInstoreGross)
  const dWolt    = deltaPct(curWoltGross, prvWoltGross)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Finance — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {monthly.length} month{monthly.length > 1 ? 's' : ''} of income data
        </span>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="kpi-row">
        <KPI label="Total revenue (gross)" value={ILS.format(curTotalGross)}
          delta={dGross} deltaSuffix={`vs ${prevMonthLabel}`} />
        <KPI label="In-store" value={ILS.format(curInstoreGross)}
          subtitle={curTotalGross > 0 ? `${PCT(instoreShare)} of revenue` : null}
          delta={dInstore} deltaSuffix={`vs ${prevMonthLabel}`} />
        <KPI label="Wolt" value={ILS.format(curWoltGross)}
          subtitle={curTotalGross > 0 ? `${PCT(woltShare)} of revenue` : null}
          delta={dWolt} deltaSuffix={`vs ${prevMonthLabel}`} />
        <KPI label="Net to bank" value={ILS.format(curTotalNet)}
          subtitle={curTotalGross > 0 ? `${PCT(curTotalNet / curTotalGross)} kept` : null}
          delta={dNet} deltaSuffix={`vs ${prevMonthLabel}`} tone={curTotalNet > prvTotalNet ? 'ok' : null} />
      </div>

      {/* ── Revenue split visual bar ─────────────────────────────────────── */}
      {curTotalGross > 0 && (
        <div className="card">
          <h2 className="section-h2">Revenue split — {monthLabel}</h2>
          <div className="finance-split-bar">
            <div
              className="finance-split-seg instore"
              style={{ flexBasis: `${instoreShare * 100}%` }}
              title={`In-store ${ILS.format(curInstoreGross)} (${PCT(instoreShare)})`}
            >
              {instoreShare > 0.07 && (
                <span>In-store {PCT(instoreShare)}</span>
              )}
            </div>
            <div
              className="finance-split-seg wolt"
              style={{ flexBasis: `${woltShare * 100}%` }}
              title={`Wolt ${ILS.format(curWoltGross)} (${PCT(woltShare)})`}
            >
              {woltShare > 0.07 && (
                <span>Wolt {PCT(woltShare)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Side-by-side channel comparison ──────────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">{monthLabel} vs {prevMonthLabel}</h2>
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th style={{ textAlign: 'right' }}>{prevMonthLabel}</th>
              <th style={{ textAlign: 'right' }}>{monthLabel}</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            <CompareRow label="In-store gross"    a={prvInstoreGross} b={curInstoreGross} />
            <CompareRow label="In-store orders"   a={prv?.instore?.orders ?? 0} b={cur.instore?.orders ?? 0} isCount />
            <CompareRow label="Wolt gross"        a={prvWoltGross} b={curWoltGross} />
            <CompareRow label="Wolt orders"       a={prv?.wolt?.orders ?? 0} b={cur.wolt?.orders ?? 0} isCount />
            <CompareRow label="Wolt fees"         a={prv?.wolt?.fees ?? 0} b={cur.wolt?.fees ?? 0} negativeIsGood />
            <CompareRow label="Total gross"       a={prvTotalGross} b={curTotalGross} bold />
            <CompareRow label="Net to bank"       a={prvTotalNet} b={curTotalNet} bold />
          </tbody>
        </table>
        {!prv && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
            No data for {prevMonthLabel} — comparisons show 0.
          </p>
        )}
      </div>

      {/* ── P&L: income − expenses = profit ──────────────────────────────── */}
      <PnLCard cur={pnlCur} prv={pnlPrv} curMonthLabel={monthLabel} prvMonthLabel={prevMonthLabel} />

      {/* ── Combined categories ──────────────────────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">Categories — {monthLabel}</h2>
        {categories.length ? <CategoriesTable rows={categories} /> : <p className="muted">No item data for this month.</p>}
      </div>

      {/* ── Combined top items ───────────────────────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">Top items combined — {monthLabel}</h2>
        {topItems.length ? <TopItemsTable items={topItems} /> : <p className="muted">No items.</p>}
      </div>

      {/* ── Monthly history with profit column ──────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">Monthly history</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: 'right' }}>In-store</th>
              <th style={{ textAlign: 'right' }}>Wolt</th>
              <th style={{ textAlign: 'right' }}>Net income</th>
              <th style={{ textAlign: 'right' }}>Expenses</th>
              <th style={{ textAlign: 'right' }}>Profit</th>
              <th style={{ textAlign: 'right' }}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {[...pnlAll].reverse().map((p) => {
              const isCur = p.month === selectedMonth
              const i = monthly.find((m) => m.month === p.month)
              return (
                <tr key={p.month} style={isCur ? { background: 'var(--brand-pink-bg)' } : null}>
                  <td style={{ fontWeight: isCur ? 700 : 500 }}>{monthLabelOf(p.month)}</td>
                  <td className="num">{i?.instore ? ILS.format(i.instore.gross) : <span className="muted">—</span>}</td>
                  <td className="num">{i?.wolt ? ILS.format(i.wolt.gross) : <span className="muted">—</span>}</td>
                  <td className="num">{ILS.format(p.income_net)}</td>
                  <td className="num">{p.expenses_total > 0 ? `−${ILS.format(p.expenses_total)}` : <span className="muted">—</span>}</td>
                  <td className="num" style={{ fontWeight: 700, color: p.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {ILS.format(p.profit)}
                  </td>
                  <td className="num">{p.margin != null ? PCT(p.margin) : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PnLCard({ cur, prv, curMonthLabel, prvMonthLabel }) {
  if (!cur || cur.expenses_total === 0) {
    return (
      <div className="card">
        <h2 className="section-h2">Profit &amp; Loss — {curMonthLabel}</h2>
        <p className="muted">
          No expenses recorded for {curMonthLabel} yet. Upload a credit-card statement or
          add manual expenses (rent, salaries) on the <a href="/admin/expenses" style={{ color: 'var(--brand-blue)' }}>Expenses page</a>{' '}
          to see the P&amp;L.
        </p>
      </div>
    )
  }

  const profitGood = cur.profit >= 0
  const dProfit = prv ? (prv.profit ? (cur.profit - prv.profit) / Math.abs(prv.profit) : null) : null
  const dExpenses = prv ? (prv.expenses_total ? (cur.expenses_total - prv.expenses_total) / prv.expenses_total : null) : null

  // Sort expense categories by amount.
  const catRows = Object.entries(cur.expenses_by_category)
    .map(([category, amount]) => ({ category, amount, share: cur.expenses_total ? amount / cur.expenses_total : 0 }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="card">
      <h2 className="section-h2">Profit &amp; Loss — {curMonthLabel}</h2>
      <table className="table">
        <thead>
          <tr>
            <th></th>
            <th style={{ textAlign: 'right' }}>{prvMonthLabel}</th>
            <th style={{ textAlign: 'right' }}>{curMonthLabel}</th>
            <th style={{ textAlign: 'right' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Income (net to bank)</td>
            <td className="num">{ILS.format(prv?.income_net || 0)}</td>
            <td className="num" style={{ fontWeight: 600 }}>{ILS.format(cur.income_net)}</td>
            <td className="num">
              {prv?.income_net ? (
                <span className={cur.income_net >= prv.income_net ? 'up-text' : 'down-text'}>
                  {((cur.income_net - prv.income_net) / prv.income_net * 100).toFixed(1)}%
                </span>
              ) : null}
            </td>
          </tr>
          <tr>
            <td>Expenses</td>
            <td className="num">−{ILS.format(prv?.expenses_total || 0)}</td>
            <td className="num" style={{ fontWeight: 600 }}>−{ILS.format(cur.expenses_total)}</td>
            <td className="num">
              {dExpenses != null && (
                <span className={dExpenses <= 0 ? 'up-text' : 'down-text'}>
                  {dExpenses >= 0 ? '+' : ''}{(dExpenses * 100).toFixed(1)}%
                </span>
              )}
            </td>
          </tr>
          <tr style={{ background: 'var(--brand-pink-bg)' }}>
            <td style={{ fontWeight: 700 }}>Profit</td>
            <td className="num" style={{ fontWeight: 700 }}>{ILS.format(prv?.profit || 0)}</td>
            <td className="num" style={{ fontWeight: 700, color: profitGood ? 'var(--success)' : 'var(--danger)' }}>
              {ILS.format(cur.profit)}
            </td>
            <td className="num">
              {dProfit != null && (
                <span className={dProfit >= 0 ? 'up-text' : 'down-text'}>
                  {dProfit >= 0 ? '+' : ''}{(dProfit * 100).toFixed(1)}%
                </span>
              )}
            </td>
          </tr>
          <tr>
            <td>Margin</td>
            <td className="num">{prv?.margin != null ? PCT(prv.margin) : '—'}</td>
            <td className="num" style={{ fontWeight: 600 }}>{cur.margin != null ? PCT(cur.margin) : '—'}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Expenses by category
        </div>
        <table className="table">
          <tbody>
            {catRows.map((c) => (
              <tr key={c.category}>
                <td>{EXPENSE_CATEGORY_LABEL[c.category] || c.category}</td>
                <td className="num">{ILS.format(c.amount)}</td>
                <td className="num">{PCT(c.share)}</td>
                <td className="finance-bar-cell">
                  <div className="finance-bar" style={{ width: `${c.share * 100}%`, background: 'var(--brand-pink-soft, #f7c8d8)' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── components ──────────────────────────────────────────────────────────────
function KPI({ label, value, subtitle, delta, deltaSuffix = 'vs prev', tone }) {
  return (
    <div className={`card kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
      {delta != null && (
        <div className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}% {deltaSuffix}
        </div>
      )}
    </div>
  )
}

function CompareRow({ label, a, b, isCount, negativeIsGood, bold }) {
  const delta = a ? (b - a) / a : null
  const goodWhen = negativeIsGood ? delta < 0 : delta > 0
  return (
    <tr>
      <td style={bold ? { fontWeight: 700 } : null}>{label}</td>
      <td className="num">{isCount ? a : ILS.format(a)}</td>
      <td className="num" style={bold ? { fontWeight: 700 } : { fontWeight: 600 }}>
        {isCount ? b : ILS.format(b)}
      </td>
      <td className="num">
        {delta != null && (
          <span className={goodWhen ? 'up-text' : 'down-text'}>
            {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
          </span>
        )}
      </td>
    </tr>
  )
}

function CategoriesTable({ rows }) {
  const grand = rows.reduce((s, r) => s + r.total_revenue, 0)
  const maxTotal = Math.max(...rows.map((r) => r.total_revenue), 1)
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Category</th>
          <th style={{ textAlign: 'right' }}>In-store</th>
          <th style={{ textAlign: 'right' }}>Wolt</th>
          <th style={{ textAlign: 'right' }}>Total</th>
          <th style={{ textAlign: 'right' }}>Share</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const share = grand ? r.total_revenue / grand : 0
          const barWidth = (r.total_revenue / maxTotal) * 100
          return (
            <tr key={r.category}>
              <td style={{ fontWeight: 600 }}>{prettyCategory(r.category)}</td>
              <td className="num">
                {r.instore_revenue > 0 ? (
                  <>{ILS.format(r.instore_revenue)} <span className="muted">/ {r.instore_units}u</span></>
                ) : <span className="muted">—</span>}
              </td>
              <td className="num">
                {r.wolt_revenue > 0 ? (
                  <>{ILS.format(r.wolt_revenue)} <span className="muted">/ {r.wolt_units}u</span></>
                ) : <span className="muted">—</span>}
              </td>
              <td className="num" style={{ fontWeight: 700 }}>{ILS.format(r.total_revenue)}</td>
              <td className="num">{PCT(share)}</td>
              <td className="finance-bar-cell">
                <div className="finance-bar" style={{ width: `${barWidth}%` }} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function TopItemsTable({ items }) {
  return (
    <table className="table top-items">
      <thead>
        <tr>
          <th>#</th>
          <th>Item</th>
          <th style={{ textAlign: 'right' }}>In-store</th>
          <th style={{ textAlign: 'right' }}>Wolt</th>
          <th style={{ textAlign: 'right' }}>Total units</th>
          <th style={{ textAlign: 'right' }}>Total revenue</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i}>
            <td className="muted">{i + 1}</td>
            <td>
              <div className="item-name">{it.item_name}</div>
              <div className="muted item-cat">{prettyCategory(it.category || 'other')}</div>
            </td>
            <td className="num">{it.instore_units > 0 ? it.instore_units : <span className="muted">—</span>}</td>
            <td className="num">{it.wolt_units > 0 ? it.wolt_units : <span className="muted">—</span>}</td>
            <td className="num" style={{ fontWeight: 600 }}>{it.total_units}</td>
            <td className="num">{ILS.format(it.total_revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
