import Link from 'next/link'
import { listEmployees } from '@/lib/db/employees'
import { listShifts } from '@/lib/db/shifts'
import { formatDuration, formatTime } from '@/lib/format'
import MonthPicker from '@/components/MonthPicker'

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
  const monthYm = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthLabel = bounds.startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const [employees, recentShifts, monthShifts] = await Promise.all([
    listEmployees({ includeInactive: true }),
    listShifts({ limit: 20 }),
    listShifts({ from: bounds.start, to: bounds.end, limit: 1000 }),
  ])

  const openShifts = recentShifts.filter((s) => !s.ended_at)
  const activeEmployees = employees.filter((e) => e.active).length
  const monthTotals = totalHoursByEmployee(monthShifts, bounds.endDate.getTime())

  return (
    <div className="stack" style={{ gap: 20 }}>
      <MonthPicker value={monthYm} />

      <div className="row" style={{ gap: 16 }}>
        <StatCard label="Active employees" value={activeEmployees} />
        <StatCard label="On shift now" value={openShifts.length} />
        <StatCard label="Total employees" value={employees.length} />
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
