'use client'

import { useState } from 'react'
import { vatAmount } from '@/lib/receipts/money'

const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_ORDER = { error: 0, pending: 1 }

// Rows that need the owner sort first: unreadable, then not yet read.
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const sa = STATUS_ORDER[a.parse_status] ?? 2
    const sb = STATUS_ORDER[b.parse_status] ?? 2
    if (sa !== sb) return sa - sb
    return (a.purchased_at || a.uploaded_at).localeCompare(b.purchased_at || b.uploaded_at)
  })
}

// Inline-edit table. Each field saves on blur or Enter through
// PATCH /api/admin/receipts/[id]; a failed save rolls the row back.
export default function ReceiptsTable({ initial }) {
  const [rows, setRows] = useState(() => sortRows(initial))
  const [savingId, setSavingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function patch(id, change) {
    const before = rows
    setSavingId(id)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)))
    try {
      const res = await fetch(`/api/admin/receipts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...j.receipt } : r)))
    } catch (e) {
      console.warn('Receipt update failed:', e)
      alertRow(id, e.message)
      setRows(before)
    } finally {
      setSavingId(null)
    }
  }

  function alertRow(id, message) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, _error: message } : r)))
  }

  // Reads the photo with Claude again. Keeps the signed photo link and the
  // uploader name, which the API row does not carry.
  async function retry(id) {
    setSavingId(id)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, _error: null } : r)))
    const res = await fetch(`/api/admin/receipts/${id}/extract`, { method: 'POST' }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    setSavingId(null)
    if (res?.ok && j.receipt) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...j.receipt } : r)))
    else alertRow(id, j.error || 'Retry failed')
  }

  async function remove(id) {
    setConfirmDelete(null)
    setSavingId(id)
    const res = await fetch(`/api/admin/receipts/${id}`, { method: 'DELETE' }).catch(() => null)
    setSavingId(null)
    if (res?.ok) setRows((rs) => rs.filter((r) => r.id !== id))
    else alertRow(id, 'Delete failed')
  }

  return (
    <div className="receipts-table-wrap">
      <table className="table receipts-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Date</th>
            <th>Time</th>
            <th>Vendor</th>
            <th>Receipt no.</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
            <th style={{ textAlign: 'right' }}>VAT</th>
            <th>Uploaded by</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-receipt-id={r.id}
              className={r.duplicate_of ? 'row-dim' : ''}
              style={savingId === r.id ? { opacity: 0.6 } : null}
            >
              <td>
                <a href={r.imageUrl} target="_blank" rel="noreferrer">
                  <img className="receipt-thumb" src={r.imageUrl} alt="Receipt photo" loading="lazy" />
                </a>
              </td>
              <td>
                <Field type="date" value={r.purchased_at} onSave={(v) => patch(r.id, { purchased_at: v })} />
              </td>
              <td>
                <Field type="time" step="1" value={r.purchased_time} onSave={(v) => patch(r.id, { purchased_time: v })} />
              </td>
              <td>
                <Field value={r.vendor} dir="auto" onSave={(v) => patch(r.id, { vendor: v })} />
              </td>
              <td>
                <Field value={r.receipt_number} onSave={(v) => patch(r.id, { receipt_number: v })} />
              </td>
              <td style={{ textAlign: 'right' }}>
                <Field
                  type="number"
                  step="0.01"
                  min="0"
                  value={r.total === null || r.total === undefined ? null : Number(r.total).toFixed(2)}
                  onSave={(v) => patch(r.id, { total: v === null ? null : Number(v) })}
                />
              </td>
              <td className="num" style={{ textAlign: 'right' }}>
                {r.total === null || r.total === undefined ? '—' : ILSp.format(vatAmount(r.total))}
              </td>
              <td className="muted">{r.employees?.name || '—'}</td>
              <td>
                <span className={`badge receipt-status receipt-status-${r.parse_status}`} title={r.parse_error || ''}>
                  {r.parse_status}
                </span>
                {r.duplicate_of && (
                  <div className="receipt-dup">
                    Duplicate ·{' '}
                    <button type="button" className="link-button" onClick={() => patch(r.id, { duplicate_of: null })}>
                      Not a duplicate
                    </button>
                  </div>
                )}
                {(r.parse_status === 'pending' || r.parse_status === 'error') && (
                  <div>
                    <button type="button" className="link-button" disabled={savingId === r.id} onClick={() => retry(r.id)}>
                      Retry
                    </button>
                  </div>
                )}
                {r._error && <div className="receipt-row-error">{r._error}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {confirmDelete === r.id ? (
                  <>
                    <button type="button" className="btn btn-danger receipt-small-btn" onClick={() => remove(r.id)}>
                      Delete
                    </button>{' '}
                    <button type="button" className="btn btn-ghost receipt-small-btn" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost receipt-small-btn" onClick={() => setConfirmDelete(r.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// An input that saves when it loses focus or on Enter, only if the value changed.
function Field({ value, onSave, ...props }) {
  const shown = value === null || value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  const [lastShown, setLastShown] = useState(shown)
  if (shown !== lastShown) {
    setLastShown(shown)
    setDraft(shown)
  }

  function commit() {
    const next = draft.trim()
    if (next === shown) return
    onSave(next === '' ? null : next)
  }

  return (
    <input
      className="input receipt-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      {...props}
    />
  )
}
