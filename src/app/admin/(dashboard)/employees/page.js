'use client'

import { useEffect, useState } from 'react'

export default function EmployeesAdminPage() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/employees?all=1')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not load')
      setEmployees(d.employees || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not add')
      setEmployees((prev) => [...prev, d.employee].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(id) {
    const current = employees.find((e) => e.id === id)
    const next = prompt('New name', current?.name || '')
    if (next == null || next.trim() === '' || next === current?.name) return
    const r = await fetch(`/api/employees/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not rename')
    setEmployees((prev) =>
      prev.map((e) => (e.id === id ? d.employee : e)).sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  async function handleToggleActive(emp) {
    const r = await fetch(`/api/employees/${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !emp.active }),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not update')
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? d.employee : e)))
  }

  async function handleDelete(emp) {
    if (
      !confirm(
        `Delete ${emp.name}? This will also delete ALL of their shift history. This cannot be undone.\n\nIf you just want to remove them from the dropdown, use "Deactivate" instead.`,
      )
    )
      return
    const r = await fetch(`/api/employees/${emp.id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return alert(d.error || 'Could not delete')
    }
    setEmployees((prev) => prev.filter((e) => e.id !== emp.id))
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Add employee</h2>
        <form onSubmit={handleAdd} className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Employee name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
        {error && (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>All employees</h2>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : employees.length === 0 ? (
          <div className="muted">No employees yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td>
                    {emp.active ? (
                      <span className="badge badge-mgr">Active</span>
                    ) : (
                      <span className="badge">Inactive</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => handleRename(emp.id)}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => handleToggleActive(emp)}
                      >
                        {emp.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => handleDelete(emp)}
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
    </div>
  )
}
