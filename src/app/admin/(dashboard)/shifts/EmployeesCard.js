'use client'

import { useState } from 'react'

export default function EmployeesCard({ employees, onChange }) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function sortByName(list) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }

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
      onChange(sortByName([...employees, d.employee]))
      setNewName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(emp) {
    const next = prompt('New name', emp.name)
    if (next == null || next.trim() === '' || next === emp.name) return
    const r = await fetch(`/api/employees/${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not rename')
    onChange(sortByName(employees.map((e) => (e.id === emp.id ? d.employee : e))), { shiftsChanged: true })
  }

  async function handleToggleActive(emp) {
    const r = await fetch(`/api/employees/${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !emp.active }),
    })
    const d = await r.json()
    if (!r.ok) return alert(d.error || 'Could not update')
    onChange(employees.map((e) => (e.id === emp.id ? d.employee : e)))
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
    onChange(employees.filter((e) => e.id !== emp.id), { shiftsChanged: true })
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Employees</h2>
      <form onSubmit={handleAdd} className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input
          className="input"
          placeholder="New employee name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
          {busy ? 'Adding…' : 'Add employee'}
        </button>
      </form>
      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {employees.length === 0 ? (
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
                      onClick={() => handleRename(emp)}
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
  )
}
