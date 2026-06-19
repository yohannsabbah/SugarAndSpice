'use client'

import { useState, useTransition } from 'react'

const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Optimistic, inline-edit table. Each row's category and is_business flag
// can be changed in place; PATCH /api/admin/expenses/[id] persists the change.
export default function ExpensesTable({ initial, categories }) {
  const [rows, setRows] = useState(initial)
  const [savingId, setSavingId] = useState(null)
  const [, startTransition] = useTransition()

  async function patch(id, change) {
    setSavingId(id)
    // Optimistic UI update first.
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)))
    try {
      const res = await fetch(`/api/admin/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      if (!res.ok) {
        // Roll back if the server rejected.
        const j = await res.json().catch(() => ({}))
        console.error('Expense update failed:', j.error || res.status)
        setRows(initial)
      }
    } catch (e) {
      console.error(e)
      setRows(initial)
    } finally {
      setSavingId(null)
    }
  }

  async function remove(id) {
    if (!confirm('Delete this expense row?')) return
    setSavingId(id)
    setRows((rs) => rs.filter((r) => r.id !== id))
    try {
      await fetch(`/api/admin/expenses/${id}`, { method: 'DELETE' })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="expenses-table-wrap">
      <table className="table expenses-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Vendor</th>
            <th>Card</th>
            <th>Category</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
            <th>Biz?</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pm = r.payment_methods
            const card = pm?.card_last4 ? `${(pm.display_name || '').split(' ')[0]} ${pm.card_last4}` : (pm?.display_name || '—')
            const dimmed = !r.is_business
            return (
              <tr key={r.id} className={dimmed ? 'row-dim' : ''} style={savingId === r.id ? { opacity: 0.6 } : null}>
                <td className="num-date">{r.transaction_date}</td>
                <td>
                  <div style={{ fontWeight: 500 }}>{r.vendor}</div>
                  {r.source_category && (
                    <div className="muted" style={{ fontSize: '0.72rem' }}>{r.source_category}</div>
                  )}
                </td>
                <td className="muted" style={{ fontSize: '0.82rem' }}>{card}</td>
                <td>
                  <select
                    value={r.category}
                    onChange={(e) => patch(r.id, { category: e.target.value })}
                    disabled={savingId === r.id}
                    className="cat-select"
                  >
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td className="num">{ILSp.format(Number(r.amount))}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.is_business}
                    onChange={(e) => patch(r.id, { is_business: e.target.checked })}
                    disabled={savingId === r.id}
                    title={r.is_business ? 'Counted in P&L' : 'Excluded from P&L'}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-link-danger"
                    onClick={() => remove(r.id)}
                    disabled={savingId === r.id}
                    title="Delete row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
