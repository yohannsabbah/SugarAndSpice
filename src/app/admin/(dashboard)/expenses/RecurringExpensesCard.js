'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const PAYMENT_LABEL = {
  cheque: 'Cheque',
  transfer: 'Bank transfer',
  standing_order: 'Standing order',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(isoDate) {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IL', { month: 'short', year: 'numeric' })
}

// Fixed amounts that count in every month, like rent. To change an amount,
// set an end month on the old one and add a new one from the next month.
export default function RecurringExpensesCard({ items, categories, tableMissing }) {
  const router = useRouter()
  const [name, setName] = useState('Rent')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('rent')
  const [paymentMethod, setPaymentMethod] = useState('cheque')
  const [includesVat, setIncludesVat] = useState(false)
  const [startMonth, setStartMonth] = useState(currentMonth())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const categoryLabel = Object.fromEntries(categories.map((c) => [c.value, c.label]))
  const ready = name.trim() && Number(amount) > 0 && startMonth && !busy

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
    const ok = await call('/api/admin/recurring-expenses', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        amount: Number(amount),
        category,
        payment_method: paymentMethod,
        includes_vat: includesVat,
        start_month: startMonth,
      }),
    })
    if (ok) setAmount('')
  }

  function onEndMonth(item, value) {
    call(`/api/admin/recurring-expenses/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ end_month: value || null }),
    })
  }

  function onDelete(item) {
    if (!confirm(`Delete "${item.name}"? It will be removed from every month.`)) return
    call(`/api/admin/recurring-expenses/${item.id}`, { method: 'DELETE' })
  }

  if (tableMissing) {
    return (
      <div className="card">
        <h2 className="section-h2">Recurring expenses</h2>
        <p className="muted">
          The recurring_expenses table does not exist yet. Run section 19 of supabase-finance-schema.sql in the
          Supabase SQL editor, then reload this page.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2 className="section-h2">Recurring expenses</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Counted in every month from the start month, until the end month. To change an amount, set an end month and
        add a new one from the next month.
      </p>

      {items.length > 0 && (
        <div style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>VAT</th>
                <th>Paid by</th>
                <th>From</th>
                <th>Until</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600 }}>{item.name}</td>
                  <td>{categoryLabel[item.category] || item.category}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {ILS.format(item.amount)}/month
                  </td>
                  <td>{item.includes_vat ? 'Included' : 'No VAT'}</td>
                  <td>{PAYMENT_LABEL[item.payment_method] || item.payment_method}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(item.start_month)}</td>
                  <td>
                    <input
                      type="month"
                      className="input"
                      aria-label={`Last month for ${item.name}`}
                      value={item.end_month ? item.end_month.slice(0, 7) : ''}
                      min={item.start_month.slice(0, 7)}
                      onChange={(e) => onEndMonth(item, e.target.value)}
                      disabled={busy}
                      style={{ width: 'auto', padding: '6px 8px', fontSize: '0.85rem' }}
                    />
                    {!item.end_month && <div className="muted" style={{ fontSize: '0.75rem' }}>ongoing</div>}
                  </td>
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
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={onAdd} className="stack" style={{ gap: 10 }}>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} required />
          </label>
          <label className="upload-field">
            <span>Amount per month (₪)</span>
            <input
              type="number" step="0.01" min="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              disabled={busy} placeholder="0.00" required
            />
          </label>
        </div>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="upload-field">
            <span>Paid by</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={busy}>
              {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Start month</span>
            <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={busy} required />
          </label>
          <label className="upload-field">
            <span>VAT</span>
            <select value={includesVat ? 'yes' : 'no'} onChange={(e) => setIncludesVat(e.target.value === 'yes')} disabled={busy}>
              <option value="no">No VAT (e.g. private landlord)</option>
              <option value="yes">Amount includes VAT (tax invoice)</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Add recurring expense'}
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
