'use client'

import { useState } from 'react'
import { vatAmount } from '@/lib/receipts/money'
import { needsCheck, sortReceipts } from '@/lib/receipts/sortReceipts'
import { RECEIPT_CATEGORIES, categoryLabel } from '@/lib/receipts/categories'
import ReceiptsSummary from './ReceiptsSummary'
import PhotoViewer from './PhotoViewer'

const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The fields the Edit button opens, as the input shows them.
function draftOf(r) {
  const s = (v) => (v === null || v === undefined ? '' : String(v))
  return {
    purchased_at: s(r.purchased_at),
    purchased_time: s(r.purchased_time),
    vendor: s(r.vendor),
    category: s(r.category),
    receipt_number: s(r.receipt_number),
    uploaded_by: s(r.uploaded_by),
    total: r.total === null || r.total === undefined ? '' : Number(r.total).toFixed(2),
  }
}

// Only the fields the owner changed, as the API expects them.
function changesOf(r, draft) {
  const before = draftOf(r)
  const change = {}
  for (const [key, raw] of Object.entries(draft)) {
    const v = raw.trim()
    if (v === before[key]) continue
    change[key] = v === '' ? null : key === 'total' ? Number(v) : v
  }
  return change
}

// Read-only table. Edit opens the inputs for one row, and Save sends the
// changed fields through PATCH /api/admin/receipts/[id]. Duplicate adds a
// second row on the same photo, for a photo that shows two receipts.
export default function ReceiptsTable({ initial, employees }) {
  const [rows, setRows] = useState(() => sortReceipts(initial))
  const [savingId, setSavingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editing, setEditing] = useState(null) // { id, draft }
  const [viewing, setViewing] = useState(null) // index into rows

  function alertRow(id, message) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, _error: message } : r)))
  }

  function startEdit(r) {
    setConfirmDelete(null)
    setEditing({ id: r.id, draft: draftOf(r) })
  }

  function setDraft(key, value) {
    setEditing((e) => ({ ...e, draft: { ...e.draft, [key]: value } }))
  }

  async function save(r) {
    const change = changesOf(r, editing.draft)
    if (Object.keys(change).length === 0) {
      setEditing(null)
      return
    }
    setSavingId(r.id)
    try {
      const res = await fetch(`/api/admin/receipts/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...j.receipt, _error: null } : x)))
      setEditing(null)
    } catch (e) {
      console.warn('Receipt update failed:', e)
      alertRow(r.id, e.message) // the inputs stay open with the owner's values
    } finally {
      setSavingId(null)
    }
  }

  // Clears the duplicate mark. The only change made without the Edit button.
  async function notDuplicate(id) {
    setSavingId(id)
    const res = await fetch(`/api/admin/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicate_of: null }),
    }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    setSavingId(null)
    if (res?.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...j.receipt } : r)))
    else alertRow(id, j.error || 'Update failed')
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

  // The new row goes right under its photo's row and opens for editing.
  async function duplicate(r) {
    setSavingId(r.id)
    const res = await fetch(`/api/admin/receipts/${r.id}/copy`, { method: 'POST' }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    setSavingId(null)
    if (!res?.ok || !j.receipt) {
      alertRow(r.id, j.error || 'Duplicate failed')
      return
    }
    const copy = { ...j.receipt, imageUrl: r.imageUrl }
    setRows((rs) => {
      const i = rs.findIndex((x) => x.id === r.id)
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)]
    })
    setConfirmDelete(null)
    setEditing({ id: copy.id, draft: draftOf(copy) })
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
    <div className="stack" style={{ gap: 20 }}>
      <ReceiptsSummary rows={rows} />

      <div className="receipts-table-wrap">
        <table className="table receipts-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Date</th>
              <th>Time</th>
              <th>Vendor</th>
              <th>Category</th>
              <th>Receipt no.</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'right' }}>VAT</th>
              <th>Uploaded by</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const draft = editing?.id === r.id ? editing.draft : null
              const busy = savingId === r.id
              return (
                <tr
                  key={r.id}
                  data-receipt-id={r.id}
                  className={r.duplicate_of ? 'row-dim' : ''}
                  style={busy ? { opacity: 0.6 } : null}
                  onKeyDown={
                    draft
                      ? (e) => {
                          if (e.key === 'Enter' && e.target.tagName === 'INPUT') save(r)
                          if (e.key === 'Escape') setEditing(null)
                        }
                      : undefined
                  }
                >
                  <td>
                    <button type="button" className="receipt-thumb-btn" onClick={() => setViewing(i)} title="Open the photo">
                      <img className="receipt-thumb" src={r.imageUrl} alt="Receipt photo" loading="lazy" />
                    </button>
                  </td>
                  {draft ? (
                    <>
                      <td><Input type="date" value={draft.purchased_at} onChange={(v) => setDraft('purchased_at', v)} /></td>
                      <td><Input type="time" step="1" value={draft.purchased_time} onChange={(v) => setDraft('purchased_time', v)} /></td>
                      <td><Input dir="auto" value={draft.vendor} onChange={(v) => setDraft('vendor', v)} /></td>
                      <td>
                        <select className="input receipt-input" value={draft.category} onChange={(e) => setDraft('category', e.target.value)}>
                          <option value="">—</option>
                          {RECEIPT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{categoryLabel(c)}</option>
                          ))}
                        </select>
                      </td>
                      <td><Input value={draft.receipt_number} onChange={(v) => setDraft('receipt_number', v)} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <Input type="number" step="0.01" min="0" value={draft.total} onChange={(v) => setDraft('total', v)} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="receipt-mono">{r.purchased_at || '—'}</td>
                      <td className="receipt-mono">{r.purchased_time ? r.purchased_time.slice(0, 5) : '—'}</td>
                      <td dir="auto">{r.vendor || '—'}</td>
                      <td className={r.category ? '' : 'muted'}>{r.category ? categoryLabel(r.category) : '—'}</td>
                      <td className="receipt-mono">{r.receipt_number || '—'}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                        {r.total === null || r.total === undefined ? '—' : ILSp.format(r.total)}
                      </td>
                    </>
                  )}
                  <td className="num" style={{ textAlign: 'right' }}>
                    {r.total === null || r.total === undefined ? '—' : ILSp.format(vatAmount(r.total))}
                  </td>
                  <td className={draft ? '' : 'muted'}>
                    {draft ? (
                      <select className="input receipt-input" value={draft.uploaded_by} onChange={(e) => setDraft('uploaded_by', e.target.value)}>
                        <option value="">—</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                    ) : (
                      r.employees?.name || '—'
                    )}
                  </td>
                  <td>
                    <span className={`badge receipt-status receipt-status-${r.parse_status}`} title={r.parse_error || ''}>
                      {r.parse_status}
                    </span>
                    {needsCheck(r) && (
                      <span className="badge receipt-status receipt-status-check" title="Claude was not sure. Check this row against the photo.">
                        check
                      </span>
                    )}
                    {r.duplicate_of && (
                      <div className="receipt-dup">
                        Duplicate ·{' '}
                        <button type="button" className="link-button" disabled={busy} onClick={() => notDuplicate(r.id)}>
                          Not a duplicate
                        </button>
                      </div>
                    )}
                    {(r.parse_status === 'pending' || r.parse_status === 'error') && (
                      <div>
                        <button type="button" className="link-button" disabled={busy} onClick={() => retry(r.id)}>
                          Retry
                        </button>
                      </div>
                    )}
                    {r._error && <div className="receipt-row-error">{r._error}</div>}
                  </td>
                  <td className="receipt-actions">
                    {draft ? (
                      <>
                        <button type="button" className="btn btn-primary receipt-small-btn" disabled={busy} onClick={() => save(r)}>
                          Save
                        </button>
                        <button type="button" className="btn btn-ghost receipt-small-btn" disabled={busy} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : confirmDelete === r.id ? (
                      <>
                        <button type="button" className="btn btn-danger receipt-small-btn" onClick={() => remove(r.id)}>
                          Delete
                        </button>
                        <button type="button" className="btn btn-ghost receipt-small-btn" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-ghost receipt-small-btn" disabled={busy} onClick={() => startEdit(r)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost receipt-small-btn"
                          disabled={busy}
                          title="This photo shows two receipts: add another row on it"
                          onClick={() => duplicate(r)}
                        >
                          Duplicate
                        </button>
                        <button type="button" className="btn btn-ghost receipt-small-btn" disabled={busy} onClick={() => setConfirmDelete(r.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {viewing !== null && rows[viewing] && (
        <PhotoViewer
          row={rows[viewing]}
          position={`${viewing + 1} / ${rows.length}`}
          onPrev={viewing > 0 ? () => setViewing(viewing - 1) : null}
          onNext={viewing < rows.length - 1 ? () => setViewing(viewing + 1) : null}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

function Input({ onChange, ...props }) {
  return <input className="input receipt-input" onChange={(e) => onChange(e.target.value)} {...props} />
}
