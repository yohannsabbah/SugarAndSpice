'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  fromLocalInputValue,
  toLocalInputValue,
} from '@/lib/format'

export default function ShiftsAdminPage() {
  const [shifts, setShifts] = useState([])
  const [employees, setEmployees] = useState([])
  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const q = filterEmployeeId ? `?employee_id=${filterEmployeeId}` : ''
      const [shiftsRes, empRes] = await Promise.all([
        fetch(`/api/shifts${q}`),
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
  }, [filterEmployeeId])

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
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Shifts</h2>
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
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.employees?.name || '—'}</td>
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
              ))}
            </tbody>
          </table>
        )}
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
