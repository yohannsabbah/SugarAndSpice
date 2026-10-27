'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const PAYMENT_LABEL = {
  transfer: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Income outside Nayax and Wolt, entered by hand: a sale to a company for an
// event, paid straight to the bank. It counts in the Store column of the
// overview. `month` is the selected 'YYYY-MM'.
export default function OtherIncomeCard({ month, monthLabel, items, tableMissing }) {
  const router = useRouter()
  // Default date: today in the current month, else the 1st of the selected month.
  const [date, setDate] = useState(today().startsWith(month) ? today() : `${month}-01`)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [includesVat, setIncludesVat] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const ready = date && description.trim() && Number(amount) > 0 && !busy
  const total = items.reduce((s, i) => s + Number(i.amount), 0)

  async function call(url, options) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`)
      router.refresh()
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onAdd(e) {
    e.preventDefault()
    if (!ready) return
    const ok = await call('/api/admin/other-income', {
      method: 'POST',
      body: JSON.stringify({
        received_on: date,
        description: description.trim(),
        amount: Number(amount),
        includes_vat: includesVat,
        payment_method: paymentMethod,
      }),
    })
    if (ok) {
      setDescription('')
      setAmount('')
    }
  }

  function onDelete(item) {
    if (!confirm(`Delete "${item.description}" (${ILS.format(item.amount)})?`)) return
    call(`/api/admin/other-income/${item.id}`, { method: 'DELETE' })
  }

  if (tableMissing) {
    return (
      <div className="card">
        <h2 className="section-h2">Other income</h2>
        <p className="muted">
          The other_income table does not exist yet. Run section 20 of supabase-finance-schema.sql in the Supabase
          SQL editor, then reload this page.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2 className="section-h2">Other income — {monthLabel}</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Sales outside Nayax and Wolt, like an event for a company paid by bank transfer. They count in the Store
        column of the overview.
      </p>

      {items.length > 0 && (
        <div style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>VAT</th>
                <th>Paid by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(`${item.received_on}T00:00:00`).toLocaleDateString('en-IL')}
                  </td>
                  <td style={{ fontWeight: 600 }}>{item.description}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ILS.format(item.amount)}</td>
                  <td>{item.includes_vat ? 'Included' : 'No VAT'}</td>
                  <td>{PAYMENT_LABEL[item.payment_method] || item.payment_method}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                      onClick={() => onDelete(item)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {items.length > 1 && (
                <tr>
                  <td colSpan={2} style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {ILS.format(total)}
                  </td>
                  <td colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={onAdd} className="stack" style={{ gap: 10 }}>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} required />
          </label>
          <label className="upload-field">
            <span>Amount received (₪)</span>
            <input
              type="number" step="0.01" min="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              disabled={busy} placeholder="0.00" required
            />
          </label>
        </div>
        <label className="upload-field">
          <span>Description</span>
          <input
            type="text"
            value={description} onChange={(e) => setDescription(e.target.value)}
            disabled={busy} placeholder="e.g. Event — Company X" required
          />
        </label>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Paid by</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={busy}>
              {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="upload-field">
            <span>VAT</span>
            <select value={includesVat ? 'yes' : 'no'} onChange={(e) => setIncludesVat(e.target.value === 'yes')} disabled={busy}>
              <option value="yes">Amount includes VAT (tax invoice)</option>
              <option value="no">No VAT</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Add income'}
          </button>
        </div>
      </form>

      {error && (
        <div className="insight bad" style={{ marginTop: 12 }}>
          <div className="insight-body">⚠ {error}</div>
        </div>
      )}
    </div>
  )
}
