import Link from 'next/link'
import { listEmployees } from '@/lib/db/employees'
import { listShifts } from '@/lib/db/shifts'
import { getWoltPeriodSummaries } from '@/lib/db/wolt'
import { getMonthlyOverview } from '@/lib/db/finance'
import MonthRangePicker from '@/components/MonthRangePicker'
import IncomeChart from '@/components/IncomeChart'
import { formatDuration, formatTime } from '@/lib/format'
import CombinedSales from './CombinedSales'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

export const dynamic = 'force-dynamic'

// The overview shows general info for the current month only. It has no month
// picker, so it ignores ?month=.
function currentMonth() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

function monthBoundsFor({ year, month }) {
  const start = new Date(year, month, 1, 0, 0, 0, 0)
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString(), startDate: start, endDate: end }
}

function totalHoursByEmployee(shifts, capAt) {
  const cap = Math.min(Date.now(), capAt)
  const totals = new Map()
  for (const s of shifts) {
    const startMs = new Date(s.started_at).getTime()
    const endMs = s.ended_at ? new Date(s.ended_at).getTime() : cap
    const ms = Math.max(0, endMs - startMs)
    const name = s.employees?.name || 'Unknown'
    totals.set(name, (totals.get(name) || 0) + ms)
  }
  return [...totals.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
}

function fmtHours(ms) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export default async function AdminOverviewPage({ searchParams }) {
  const sp = await searchParams
  const { year, month } = currentMonth()
  const bounds = monthBoundsFor({ year, month })
  const monthLabel = bounds.startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const [employees, recentShifts, monthShifts, woltPeriods, overview] = await Promise.all([
    listEmployees({ includeInactive: true }),
    listShifts({ limit: 20 }),
    listShifts({ from: bounds.start, to: bounds.end, limit: 1000 }),
    getWoltPeriodSummaries().catch(() => []),
    getMonthlyOverview().catch(() => []),
  ])

  const latestWolt = woltPeriods[woltPeriods.length - 1] || null

  const openShifts = recentShifts.filter((s) => !s.ended_at)
  const activeEmployees = employees.filter((e) => e.active).length
  const monthTotals = totalHoursByEmployee(monthShifts, bounds.endDate.getTime())

  return (
    <div className="stack" style={{ gap: 20 }}>
      <MonthlySummaryCard rows={overview} searchParams={sp || {}} />

      {/* Section tiles — direct entry to each admin area */}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <SectionTile
          href="/admin/wolt"
          title="Wolt insights"
          subtitle={
            latestWolt
              ? `Last payout ${ILS.format(latestWolt.net_payout || 0)} · ${latestWolt.orders_delivered} orders`
              : 'No data yet'
          }
          accent="pink"
          badge={latestWolt ? `P${latestWolt.period_num}` : null}
        />
        <SectionTile
          href="/admin/shifts"
          title="Shifts"
          subtitle={
            openShifts.length
              ? `${openShifts.length} on shift now`
              : `${activeEmployees} active employees`
          }
          accent="blue"
        />
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Currently on shift</h2>
          <Link href="/admin/shifts" className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: '0.9rem' }}>
            View all shifts
          </Link>
        </div>
        {openShifts.length === 0 ? (
          <div className="muted">Nobody is clocked in right now.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {openShifts.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.employees?.name || 'Unknown'}</td>
                  <td>{formatTime(s.started_at)}</td>
                  <td>{formatDuration(s.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Hours — {monthLabel}</h2>
        </div>
        {monthTotals.length === 0 ? (
          <div className="muted">No shifts logged in {monthLabel}.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {monthTotals.map((row) => (
                <tr key={row.name}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtHours(row.ms)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>Total</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(monthTotals.reduce((sum, r) => sum + r.ms, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <CombinedSales month={`${year}-${String(month + 1).padStart(2, '0')}`} monthLabel={monthLabel} />
    </div>
  )
}

// Wolt pays out in two half-month periods, so a month needs both to be complete.
const WOLT_PERIODS_PER_MONTH = 2

const YM = /^\d{4}-\d{2}$/
// The business's first month. The month summary never goes earlier.
const FIRST_MONTH = '2026-01'
// Months the summary shows by default, counting the current month.
const DEFAULT_MONTHS = 6

// Every 'YYYY-MM' from `from` to `to`, oldest first.
function monthsBetween(from, to) {
  const months = []
  let [y, m] = from.split('-').map(Number)
  for (let key = from; key <= to; ) {
    months.push(key)
    m += 1
    if (m > 12) { m = 1; y += 1 }
    key = `${y}-${String(m).padStart(2, '0')}`
  }
  return months
}

function MonthlySummaryCard({ rows: allRows, searchParams }) {
  const { from: fromParam, to: toParam } = searchParams
  const view = searchParams.view === 'chart' ? 'chart' : 'table'
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // The range defaults to the last DEFAULT_MONTHS months and can reach back to
  // FIRST_MONTH. Months with no data become empty rows, so every column is
  // flagged as missing.
  const back = new Date(now.getFullYear(), now.getMonth() - (DEFAULT_MONTHS - 1), 1)
  const backMonth = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}`
  const defaultFrom = backMonth > FIRST_MONTH ? backMonth : FIRST_MONTH
  const inRange = (ym) => YM.test(ym || '') && ym >= FIRST_MONTH && ym <= currentMonth
  let from = inRange(fromParam) ? fromParam : defaultFrom
  let to = inRange(toParam) ? toParam : currentMonth
  if (from > to) [from, to] = [to, from]
  const byMonth = new Map(allRows.map((r) => [r.month, r]))
  const rows = monthsBetween(from, to)
    .reverse()
    .map((month) => byMonth.get(month) || {
      month, store: null, wolt: null, wolt_periods: 0, expenses: null, salary: null,
      profit: 0, vat_to_pay: 0,
    })

  const gapsOf = (r) => {
    if (r.month === currentMonth) return []
    const gaps = []
    if (r.store == null) gaps.push('store')
    if (r.wolt_periods < WOLT_PERIODS_PER_MONTH) gaps.push('wolt')
    if (r.expenses == null) gaps.push('expenses')
    if (r.salary == null) gaps.push('salary')
    return gaps
  }
  const incompleteCount = rows.filter((r) => gapsOf(r).length > 0).length

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Month by month</h2>
          {incompleteCount > 0 && (
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--warning)' }}>
              {incompleteCount} month{incompleteCount > 1 ? 's' : ''} missing uploads
            </span>
          )}
        </div>
        <MonthRangePicker
          from={from}
          to={to}
          defaultFrom={defaultFrom}
          min={FIRST_MONTH}
          max={currentMonth}
          defaultLabel={`Last ${DEFAULT_MONTHS} months`}
        />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          {view === 'chart'
            ? 'Amounts without VAT. Hover a month for the numbers.'
            : 'Amounts without VAT. The small number under each amount includes VAT, as Nayax and Wolt show it.'}
        </p>
        <ViewToggle view={view} searchParams={searchParams} />
      </div>
      {view === 'chart' ? (
        <IncomeChart
          rows={[...rows].reverse().map((r) => ({
            month: r.month,
            label: new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' }),
            store: addUp([r.store, r.store_other])?.excl ?? null,
            wolt: r.wolt?.excl ?? null,
            inProgress: r.month === currentMonth,
          }))}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table summary-table">
            {/* Shaded columns are the subtotals: Income, Total expenses, Profit. */}
            <colgroup>
              <col />
              <col />
              <col />
              <col className="summary-subtotal" />
              <col />
              <col />
              <col className="summary-subtotal" />
              <col className="summary-subtotal" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Store</th>
                <th style={{ textAlign: 'right' }}>Wolt (after fees)</th>
                <th style={{ textAlign: 'right' }}>Income</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Salary</th>
                <th style={{ textAlign: 'right' }}>Total expenses</th>
                <th style={{ textAlign: 'right' }}>Profit</th>
                <th style={{ textAlign: 'right' }} title="VAT on sales minus reclaimable VAT on Wolt fees and expenses. Not part of profit.">
                  VAT to pay
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const gaps = gapsOf(r)
                const inProgress = r.month === currentMonth
                const label = new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  year: 'numeric',
                })
                return (
                  <tr key={r.month}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {label}
                      {inProgress && (
                        <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>in progress</div>
                      )}
                    </td>
                    <MoneyCell
                      value={addUp([r.store, r.store_other])}
                      extra={r.store_other ? `${ILS.format(r.store_other.incl)} other income` : null}
                      missing={gaps.includes('store')}
                      href="/admin/nayax"
                    />
                    <MoneyCell
                      value={r.wolt}
                      extra={r.wolt_total_sales != null ? `${ILS.format(r.wolt_total_sales)} total sales` : null}
                      missing={gaps.includes('wolt')}
                      href="/admin/wolt"
                      missingLabel={r.wolt_periods > 0 ? `${r.wolt_periods}/${WOLT_PERIODS_PER_MONTH} periods` : undefined}
                    />
                    <MoneyCell
                      value={addUp([r.store, r.store_other, r.wolt])}
                      incomplete={gaps.includes('store') || gaps.includes('wolt')}
                      strong
                    />
                    <MoneyCell
                      value={r.expenses}
                      missing={gaps.includes('expenses')}
                      href="/admin/expenses"
                      negative
                    />
                    <MoneyCell value={r.salary} missing={gaps.includes('salary')} href="/admin/shifts" negative />
                    <MoneyCell
                      value={addUp([r.expenses, r.salary])}
                      incomplete={gaps.includes('expenses') || gaps.includes('salary')}
                      negative
                      strong
                    />
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color: gaps.length ? 'var(--fg-muted)' : r.profit >= 0 ? 'var(--success)' : 'var(--danger)',
                      }}
                      title={gaps.length ? 'Incomplete: some data is missing' : undefined}
                    >
                      {signed(r.profit)}
                    </td>
                    <td
                      className="muted"
                      style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                      title={gaps.length ? 'Incomplete: some data is missing' : undefined}
                    >
                      {signed(r.vat_to_pay)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Table / Chart switch. Links keep the other params (from, to), so the range stays.
function ViewToggle({ view, searchParams }) {
  const hrefFor = (v) => {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(([, value]) => typeof value === 'string'),
    )
    if (v === 'table') params.delete('view')
    else params.set('view', v)
    const qs = params.toString()
    return qs ? `/admin?${qs}` : '/admin'
  }
  const item = (v, label) => (
    <Link
      href={hrefFor(v)}
      scroll={false}
      aria-current={view === v ? 'page' : undefined}
      style={{
        padding: '6px 14px',
        fontSize: '0.85rem',
        fontWeight: 600,
        borderRadius: 8,
        background: view === v ? 'var(--brand-blue-bg)' : 'transparent',
        color: view === v ? 'var(--brand-blue-dark)' : 'var(--fg-muted)',
      }}
    >
      {label}
    </Link>
  )
  return (
    <div className="row" style={{ gap: 2, padding: 2, border: '1px solid var(--border)', borderRadius: 10 }}>
      {item('table', 'Table')}
      {item('chart', 'Chart')}
    </div>
  )
}

// Sum of money cells: each part is { incl, excl }, a number (no VAT), or null.
// Returns null when every part is null.
function addUp(parts) {
  const present = parts.filter((p) => p != null)
  if (!present.length) return null
  return present.reduce(
    (sum, p) => typeof p === 'number'
      ? { incl: sum.incl + p, excl: sum.excl + p }
      : { incl: sum.incl + p.incl, excl: sum.excl + p.excl },
    { incl: 0, excl: 0 },
  )
}

function signed(amount) {
  return `${amount < 0 ? '−' : ''}${ILS.format(Math.abs(amount))}`
}

// value: a number (no VAT, e.g. salary) or { incl, excl } (shows excl, with
// the VAT-included amount in small text under it). `extra` adds one more
// small line under the amount. `strong` marks a subtotal; `incomplete` greys
// it out when some of its parts are missing.
function MoneyCell({ value, missing, href, missingLabel, negative, extra, strong, incomplete }) {
  const hasValue = value != null
  const excl = typeof value === 'number' ? value : value?.excl
  const sign = negative && excl > 0 ? '−' : ''
  return (
    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {hasValue && (
        <>
          <div
            style={strong ? { fontWeight: 700, color: incomplete ? 'var(--fg-muted)' : undefined } : undefined}
            title={incomplete ? 'Incomplete: some data is missing' : undefined}
          >
            {sign}{ILS.format(excl)}
          </div>
          {typeof value === 'object' && (
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              {sign}{ILS.format(value.incl)} incl. VAT
            </div>
          )}
          {extra && <div className="muted" style={{ fontSize: '0.72rem' }}>{extra}</div>}
        </>
      )}
      {missing ? (
        <Link
          href={href}
          style={{
            display: 'inline-block',
            marginTop: hasValue ? 4 : 0,
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'rgba(212, 155, 74, 0.15)',
            color: 'var(--warning)',
          }}
        >
          {missingLabel || 'Missing'}
        </Link>
      ) : !hasValue ? (
        <span className="muted">—</span>
      ) : null}
    </td>
  )
}

function SectionTile({ href, title, subtitle, accent, badge }) {
  const accentColor = accent === 'pink' ? 'var(--brand-pink)' : 'var(--brand-blue)'
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '16px',
        borderRadius: 12,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${accentColor}`,
        boxShadow: 'var(--shadow)',
        transition: 'transform 0.05s ease, box-shadow 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{title}</div>
        {badge && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 8px', borderRadius: 999,
            background: accentColor, color: 'white',
          }}>{badge}</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>{subtitle}</div>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: accentColor, marginTop: 8 }}>
        Open →
      </div>
    </Link>
  )
}
