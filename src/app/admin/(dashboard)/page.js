import Link from 'next/link'
import { listEmployees } from '@/lib/db/employees'
import { listShifts } from '@/lib/db/shifts'
import { getWoltPeriodSummaries } from '@/lib/db/wolt'
import { formatDuration, formatTime } from '@/lib/format'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

export const dynamic = 'force-dynamic'

function parseMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  }
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month: m - 1 }
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
  const { year, month } = parseMonth(sp?.month)
  const bounds = monthBoundsFor({ year, month })
  const monthLabel = bounds.startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const [employees, recentShifts, monthShifts, woltPeriods] = await Promise.all([
    listEmployees({ includeInactive: true }),
    listShifts({ limit: 20 }),
    listShifts({ from: bounds.start, to: bounds.end, limit: 1000 }),
    getWoltPeriodSummaries().catch(() => []),
  ])

  const latestWolt = woltPeriods[woltPeriods.length - 1] || null

  const openShifts = recentShifts.filter((s) => !s.ended_at)
  const activeEmployees = employees.filter((e) => e.active).length
  const monthTotals = totalHoursByEmployee(monthShifts, bounds.endDate.getTime())

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 16 }}>
        <StatCard label="Active employees" value={activeEmployees} />
        <StatCard label="On shift now" value={openShifts.length} />
        <StatCard label="Total employees" value={employees.length} />
      </div>

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
          href="/admin/sales"
          title="In-store sales"
          subtitle="Daily Nayax totals"
          accent="blue"
        />
        <SectionTile
          href="/admin/shifts"
          title="Shifts"
          subtitle={
            openShifts.length
              ? `${openShifts.length} on shift now`
              : 'Hours per employee'
          }
          accent="blue"
        />
        <SectionTile
          href="/admin/employees"
          title="Employees"
          subtitle={`${activeEmployees} active`}
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
    </div>
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

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  )
}
