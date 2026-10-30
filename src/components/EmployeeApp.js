'use client'

import { useEffect, useState } from 'react'
import ReceiptButton from '@/components/ReceiptButton'
import RecentReceipts from '@/components/RecentReceipts'
import { formatDuration, formatTime } from '@/lib/format'
import { LAST_EMPLOYEE_KEY } from '@/lib/storageKeys'

function readSaved() {
  try {
    return localStorage.getItem(LAST_EMPLOYEE_KEY)
  } catch {
    return null
  }
}

function writeSaved(id) {
  try {
    if (id) localStorage.setItem(LAST_EMPLOYEE_KEY, id)
    else localStorage.removeItem(LAST_EMPLOYEE_KEY)
  } catch {
    // Private mode: the employee picks their name again next time.
  }
}

// The employee screens. First the employee taps their name; the phone
// remembers it, so the next visit opens straight on the shift and receipt
// buttons. Every receipt is then recorded with its uploader.
export default function EmployeeApp() {
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = readSaved()
    fetch('/api/employees')
      .then((r) => r.json())
      .then((d) => {
        const list = d.employees || []
        setEmployees(list)
        // A saved id of a removed or inactive employee goes back to the name list.
        if (saved && list.some((e) => e.id === saved)) setEmployeeId(saved)
        else writeSaved(null)
      })
      .catch(() => setError('Could not load employees'))
      .finally(() => setLoading(false))
  }, [])

  const employee = employees.find((e) => e.id === employeeId) || null

  function signIn(id) {
    writeSaved(id)
    setEmployeeId(id)
  }

  function signOut() {
    writeSaved(null)
    setEmployeeId('')
  }

  if (loading) {
    return (
      <div className="container home-layout">
        <div className="employee-bar">
          <Logo />
        </div>
        <div className="employee-main">
          <div className="card muted">Loading…</div>
        </div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="container home-layout">
        <div className="employee-bar">
          <Logo />
        </div>
        <div className="employee-main">
          <div className="card stack">
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, textAlign: 'center' }}>Who are you?</h2>
            {error && <div className="error">{error}</div>}
            {employees.length === 0 && !error ? (
              <p className="muted" style={{ textAlign: 'center' }}>
                No employees yet. Ask your manager to add you in the admin section.
              </p>
            ) : (
              <div className="name-grid">
                {employees.map((e) => (
                  <button key={e.id} type="button" className="name-box" onClick={() => signIn(e.id)}>
                    {e.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return <EmployeeHome key={employee.id} employee={employee} onSignOut={signOut} />
}

function EmployeeHome({ employee, onSignOut }) {
  const [openShift, setOpenShift] = useState(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)
  const [receiptsVersion, setReceiptsVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/shifts/open?employee_id=${employee.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setOpenShift(d.shift || null)
      })
      .catch(() => {
        if (!cancelled) setError('Could not check your shift')
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [employee.id])

  // Redraws the shift timer.
  useEffect(() => {
    if (!openShift) return
    const t = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [openShift])

  async function shiftRequest(path, body, failText) {
    setBusy(true)
    setError('')
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || failText)
      return d
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleStart() {
    const d = await shiftRequest('/api/shifts/start', { employee_id: employee.id }, 'Could not start shift')
    if (d) setOpenShift(d.shift)
  }

  async function handleEnd() {
    if (!confirm('End your shift now?')) return
    const d = await shiftRequest('/api/shifts/end', { shift_id: openShift.id }, 'Could not end shift')
    if (d) setOpenShift(null)
  }

  function handleSignOut() {
    if (
      openShift &&
      !confirm("You're still clocked in. Signing out leaves your shift open — your time keeps counting. Continue?")
    ) {
      return
    }
    onSignOut()
  }

  return (
    <div className="container home-layout">
      <div className="employee-bar">
        <Logo />
        <span className="employee-bar-name">{employee.name}</span>
        <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
      <div className="employee-main">
        <div className="card stack">
          {error && <div className="error">{error}</div>}
          {checking ? (
            <div className="muted">Loading…</div>
          ) : openShift ? (
            <ShiftInProgress shift={openShift} onEnd={handleEnd} busy={busy} />
          ) : (
            <button className="btn btn-pink btn-lg btn-block" onClick={handleStart} disabled={busy}>
              {busy ? 'Starting…' : 'Start shift'}
            </button>
          )}
          <ReceiptButton
            variant="large"
            employeeId={employee.id}
            onUploaded={() => setReceiptsVersion((v) => v + 1)}
          />
          <RecentReceipts refreshKey={receiptsVersion} />
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return <img src="/logo.png" alt="Sugar & Spice — special cafe" className="employee-bar-logo" />
}

function ShiftInProgress({ shift, onEnd, busy }) {
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
        <div style={{ fontSize: '2.4rem', fontWeight: 700, marginTop: 8 }}>{formatDuration(shift.started_at)}</div>
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
