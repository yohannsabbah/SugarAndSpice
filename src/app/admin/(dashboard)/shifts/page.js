'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatDurationFromMs,
  fromLocalInputValue,
  shiftDurationMs,
  toLocalInputValue,
} from '@/lib/format'
import {
  getShiftOpeningIssues,
  isShiftOutsideOpeningHours,
  openingHoursSchedule,
  totalOpeningMsInMonth,
} from '@/lib/openingHours'

const ILSp = new Intl.NumberFormat('en-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const DEFAULT_HOURLY_RATE = 35
const IRA_HOURLY_RATE = 50
const HIGHLIGHT_ORANGE = '#ffedd5'
const HIGHLIGHT_YELLOW = '#fef9c3'
const HIGHLIGHT_RED = '#fde8e8'

function isIra(name) {
  return name?.trim().toLowerCase() === 'ira'
}

function isJenny(name) {
  return name?.trim().toLowerCase() === 'jenny'
}

function currentMonthYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabelOf(month) {
  return new Date(`${month}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  return {
    from: new Date(y, m - 1, 1).toISOString(),
    to: new Date(y, m, 0, 23, 59, 59, 999).toISOString(),
  }
}

function hourlyRateFor(name) {
  return isIra(name) ? IRA_HOURLY_RATE : DEFAULT_HOURLY_RATE
}

function shiftRowStyle(startedAt, endedAt) {
  const hours = shiftDurationMs(startedAt, endedAt) / 3_600_000
  if (hours > 8) return { background: HIGHLIGHT_RED }
  if (hours > 7) return { background: HIGHLIGHT_YELLOW }
  if (isShiftOutsideOpeningHours(startedAt, endedAt)) return { background: HIGHLIGHT_ORANGE }
  return undefined
}

function shiftRowTitle(startedAt, endedAt) {
  const issues = []
  const hours = shiftDurationMs(startedAt, endedAt) / 3_600_000
  if (hours > 8) issues.push('Shift longer than 8 hours')
  else if (hours > 7) issues.push('Shift longer than 7 hours')
  issues.push(...getShiftOpeningIssues(startedAt, endedAt))
  return issues.length ? issues.join(' · ') : undefined
}

function ShiftHighlightLegend() {
  const items = [
    { color: HIGHLIGHT_ORANGE, label: 'Outside opening hours' },
    { color: HIGHLIGHT_YELLOW, label: 'Longer than 7 hours' },
    { color: HIGHLIGHT_RED, label: 'Longer than 8 hours' },
  ]

  return (
    <div
      className="row"
      style={{ gap: 20, marginTop: 16, flexWrap: 'wrap', fontSize: '0.85rem' }}
    >
      {items.map(({ color, label }) => (
        <div key={label} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: color,
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}
          />
          <span className="muted">{label}</span>
        </div>
      ))}
    </div>
  )
}

export default function ShiftsAdminPage() {
  const searchParams = useSearchParams()
  const selectedMonth = useMemo(() => {
    const month = searchParams.get('month')
    return month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonthYm()
  }, [searchParams])
  const monthLabel = useMemo(() => monthLabelOf(selectedMonth), [selectedMonth])

  const [shifts, setShifts] = useState([])
  const [employees, setEmployees] = useState([])
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  const monthOpeningMs = useMemo(() => totalOpeningMsInMonth(selectedMonth), [selectedMonth])

  const summary = useMemo(() => {
    const byEmployee = new Map()
    for (const shift of shifts) {
      const name = shift.employees?.name || 'Unknown'

      const entry = byEmployee.get(name) || {
        name,
        shiftCount: 0,
        durationMs: 0,
        rate: hourlyRateFor(name),
      }
      entry.shiftCount += 1
      entry.durationMs += shiftDurationMs(shift.started_at, shift.ended_at)
      byEmployee.set(name, entry)
    }

    const useJennyRemainder = !filterEmployeeId
    let jennyMs = null
    if (useJennyRemainder) {
      let othersMs = 0
      for (const entry of byEmployee.values()) {
        if (!isJenny(entry.name) && !isIra(entry.name)) othersMs += entry.durationMs
      }
      jennyMs = monthOpeningMs - othersMs
    }

    let rows = [...byEmployee.values()].map((row) => {
      const durationMs = jennyMs !== null && isJenny(row.name) ? jennyMs : row.durationMs
      const hours = durationMs / 3_600_000
      return {
        ...row,
        durationMs,
        hours,
        pay: hours * row.rate,
      }
    })

    if (jennyMs !== null && !rows.some((r) => isJenny(r.name))) {
      const jennyName = employees.find((e) => isJenny(e.name))?.name
      if (jennyName) {
        const hours = jennyMs / 3_600_000
        rows.push({
          name: jennyName,
          shiftCount: 0,
          durationMs: jennyMs,
          rate: hourlyRateFor(jennyName),
          hours,
          pay: hours * hourlyRateFor(jennyName),
        })
      }
    }

    rows = rows.sort((a, b) => a.name.localeCompare(b.name))

    const totals = rows.reduce(
      (acc, row) => ({
        shiftCount: acc.shiftCount + row.shiftCount,
        durationMs: acc.durationMs + row.durationMs,
        pay: acc.pay + row.pay,
      }),
      { shiftCount: 0, durationMs: 0, pay: 0 },
    )

    return { rows, totals }
  }, [shifts, monthOpeningMs, filterEmployeeId, employees])

  async function load() {
    setLoading(true)
    try {
      const { from, to } = monthRange(selectedMonth)
      const params = new URLSearchParams({ from, to })
      if (filterEmployeeId) params.set('employee_id', filterEmployeeId)
      const [shiftsRes, empRes] = await Promise.all([
        fetch(`/api/shifts?${params}`),
        fetch('/api/employees?all=1'),
      ])
      const sd = await shiftsRes.json()
      const ed = await empRes.json()
      if (!shiftsRes.ok) throw new Error(sd.error || 'Could not load shifts')
      if (!empRes.ok) throw new Error(ed.error || 'Could not load employees')
      setShifts(sd.shifts || [])
      setEmployees(ed.employees || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmployeeId, selectedMonth])

  async function handleDelete(shift) {
    if (!confirm(`Delete this shift for ${shift.employees?.name}?`)) return
    const r = await fetch(`/api/shifts/${shift.id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return alert(d.error || 'Could not delete')
    }
    setShifts((prev) => prev.filter((s) => s.id !== shift.id))
  }

  async function handleSaveEdit(updated) {
    const r = await fetch(`/api/shifts/${updated.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated.patch),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not save')
    setShifts((prev) => prev.map((s) => (s.id === d.shift.id ? { ...s, ...d.shift } : s)))
    setEditing(null)
  }

  async function handleCreate(payload) {
    const r = await fetch('/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not create')
    await load()
    setAdding(false)
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="label" htmlFor="filter" style={{ margin: 0 }}>
              Filter
            </label>
            <select
              id="filter"
              className="select"
              value={filterEmployeeId}
              onChange={(e) => setFilterEmployeeId(e.target.value)}
              style={{ width: 'auto', minWidth: 200 }}
            >
              <option value="">All employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add shift manually
          </button>
        </div>
        {error && (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>
          Summary — {monthLabel}
        </h2>
        <p className="muted" style={{ marginBottom: 12, fontSize: '0.9rem' }}>
          Scheduled shop hours:{' '}
          <strong style={{ color: 'var(--brand-blue-dark)' }}>
            {formatDurationFromMs(monthOpeningMs)}
          </strong>
          {' · '}
          Jenny = scheduled hours minus other waiters (Ira excluded from the remainder)
        </p>
        <details style={{ marginBottom: 12, fontSize: '0.85rem' }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Opening hours
          </summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {openingHoursSchedule().map(({ name, label }) => (
              <li key={name}>
                <strong>{name}</strong>: {label}
              </li>
            ))}
          </ul>
        </details>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : summary.rows.length === 0 ? (
          <div className="muted">No shifts this month.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th style={{ textAlign: 'right' }}>Shifts</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Pay</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => {
                const jenny = isJenny(row.name)
                return (
                  <tr key={row.name}>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ textAlign: 'right' }}>{row.shiftCount}</td>
                    <td style={{ textAlign: 'right' }}>{formatDurationFromMs(row.durationMs)}</td>
                    <td style={{ textAlign: 'right' }}>{ILSp.format(row.rate)}/h</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {jenny ? `(${ILSp.format(row.pay)})` : ILSp.format(row.pay)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{summary.totals.shiftCount}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                  {formatDurationFromMs(summary.totals.durationMs)}
                </td>
                <td />
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{ILSp.format(summary.totals.pay)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Shifts — {monthLabel}</h2>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : shifts.length === 0 ? (
          <div className="muted">No shifts to show.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
                <th>Note</th>
                <th>Edits</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const name = s.employees?.name || '—'
                return (
                <tr
                  key={s.id}
                  style={shiftRowStyle(s.started_at, s.ended_at)}
                  title={shiftRowTitle(s.started_at, s.ended_at)}
                >
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td>{formatDate(s.started_at)}</td>
                  <td>{formatDateTime(s.started_at)}</td>
                  <td>
                    {s.ended_at ? (
                      formatDateTime(s.ended_at)
                    ) : (
                      <span className="badge badge-open">Open</span>
                    )}
                  </td>
                  <td>{formatDuration(s.started_at, s.ended_at)}</td>
                  <td style={{ maxWidth: 200, color: 'var(--fg-muted)', fontSize: '0.9rem' }}>
                    {s.note || ''}
                  </td>
                  <td>
                    {s.edited_by_employee && <span className="badge badge-emp">Employee</span>}{' '}
                    {s.edited_by_manager && <span className="badge badge-mgr">Manager</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => setEditing(s)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => handleDelete(s)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {!loading && <ShiftHighlightLegend />}
      </div>

      {editing && (
        <ShiftEditModal
          shift={editing}
          employees={employees}
          onClose={() => setEditing(null)}
          onSave={handleSaveEdit}
        />
      )}
      {adding && (
        <ShiftAddModal
          employees={employees}
          onClose={() => setAdding(false)}
          onSave={handleCreate}
        />
      )}
    </div>
  )
}

function ModalShell({ children, onClose, title }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 51, 73, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 480, width: '100%', background: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ShiftEditModal({ shift, employees, onClose, onSave }) {
  const [employeeId, setEmployeeId] = useState(shift.employee_id)
  const [startedAt, setStartedAt] = useState(toLocalInputValue(shift.started_at))
  const [endedAt, setEndedAt] = useState(toLocalInputValue(shift.ended_at))
  const [note, setNote] = useState(shift.note || '')

  function handleSubmit(e) {
    e.preventDefault()
    const patch = {}
    if (employeeId !== shift.employee_id) patch.employee_id = employeeId
    const nextStart = fromLocalInputValue(startedAt)
    if (nextStart !== shift.started_at) patch.started_at = nextStart
    const nextEnd = endedAt ? fromLocalInputValue(endedAt) : null
    if (nextEnd !== shift.ended_at) patch.ended_at = nextEnd
    if (note !== (shift.note || '')) patch.note = note
    if (Object.keys(patch).length === 0) return onClose()
    onSave({ id: shift.id, patch })
  }

  return (
    <ModalShell title="Edit shift" onClose={onClose}>
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <label className="label">Employee</label>
          <select className="select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Started at</label>
          <input
            type="datetime-local"
            className="input"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Ended at</label>
          <input
            type="datetime-local"
            className="input"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
          <div className="muted" style={{ marginTop: 6 }}>
            Leave empty if shift is still open.
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function ShiftAddModal({ employees, onClose, onSave }) {
  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees])
  const [employeeId, setEmployeeId] = useState(activeEmployees[0]?.id || '')
  const [startedAt, setStartedAt] = useState(toLocalInputValue(new Date().toISOString()))
  const [endedAt, setEndedAt] = useState('')
  const [note, setNote] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!employeeId || !startedAt) return
    onSave({
      employee_id: employeeId,
      started_at: fromLocalInputValue(startedAt),
      ended_at: endedAt ? fromLocalInputValue(endedAt) : null,
      note: note || null,
    })
  }

  return (
    <ModalShell title="Add shift" onClose={onClose}>
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <label className="label">Employee</label>
          <select className="select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {activeEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Started at</label>
          <input
            type="datetime-local"
            className="input"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Ended at</label>
          <input
            type="datetime-local"
            className="input"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Add shift
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
