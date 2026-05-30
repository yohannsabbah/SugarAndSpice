'use client'

import { useEffect, useMemo, useState } from 'react'
import BrandTitle from '@/components/BrandTitle'
import { formatDuration, formatTime } from '@/lib/format'

const STORAGE_KEY = 'ss_last_employee_id'

export default function EmployeePage() {
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [openShift, setOpenShift] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  const employee = useMemo(
    () => employees.find((e) => e.id === employeeId) || null,
    [employees, employeeId],
  )

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    fetch('/api/employees')
      .then((r) => r.json())
      .then((d) => {
        setEmployees(d.employees || [])
        if (saved && d.employees?.some((e) => e.id === saved)) {
          setEmployeeId(saved)
        }
      })
      .catch(() => setError('Could not load employees'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!employeeId) {
      setOpenShift(null)
      return
    }
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, employeeId)
    let cancelled = false
    fetch(`/api/shifts/open?employee_id=${employeeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setOpenShift(d.shift || null)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId])

  useEffect(() => {
    if (!openShift) return
    const t = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [openShift])

  async function handleStart() {
    if (!employeeId) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/shifts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not start shift')
      setOpenShift(d.shift)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleEnd() {
    if (!openShift) return
    if (!confirm('End your shift now?')) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/shifts/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shift_id: openShift.id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not end shift')
      setOpenShift(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function handleSwitchUser() {
    if (
      openShift &&
      !confirm(
        "You're still clocked in. Switching to another user will leave your shift open — your time keeps counting. Continue?",
      )
    ) {
      return
    }
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
    setEmployeeId('')
    setOpenShift(null)
    setError('')
  }

  return (
    <div className="container" style={{ position: 'relative' }}>
      {employeeId && !loading && (
        <button
          className="btn btn-ghost"
          onClick={handleSwitchUser}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            padding: '8px 14px',
            fontSize: '0.85rem',
            zIndex: 1,
          }}
        >
          Switch user
        </button>
      )}
      <BrandTitle subtitle="employee shift" />

      <div className="card">
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="stack">
            <div>
              <label className="label" htmlFor="employee">
                Who&apos;s working?
              </label>
              <select
                id="employee"
                className="select"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={!!openShift}
              >
                <option value="">— Choose your name —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
              {employees.length === 0 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  No employees yet. Ask your manager to add you in the admin section.
                </p>
              )}
            </div>

            {error && <div className="error">{error}</div>}

            {employee && !openShift && (
              <button
                className="btn btn-success btn-lg btn-block"
                onClick={handleStart}
                disabled={busy}
              >
                {busy ? 'Starting…' : `Start shift — ${employee.name}`}
              </button>
            )}

            {openShift && employee && (
              <ShiftInProgress
                shift={openShift}
                employee={employee}
                onEnd={handleEnd}
                busy={busy}
                tick={tick}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ShiftInProgress({ shift, employee, onEnd, busy, tick: _tick }) {
  return (
    <div className="stack">
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          background: 'var(--brand-pink-bg)',
          border: '1px solid var(--brand-pink-soft)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          On shift
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 600, marginTop: 4 }}>
          {employee.name}
        </div>
        <div style={{ fontSize: '2.4rem', fontWeight: 700, marginTop: 12 }}>
          {formatDuration(shift.started_at)}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          Started at {formatTime(shift.started_at)}
        </div>
      </div>
      <button className="btn btn-danger btn-lg btn-block" onClick={onEnd} disabled={busy}>
        {busy ? 'Ending…' : 'End shift'}
      </button>
    </div>
  )
}
