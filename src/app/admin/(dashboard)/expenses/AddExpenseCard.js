'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

// Same keys as PAID_BY in lib/db/expenses.js and recurring_expenses.payment_method.
const PAID_BY_LABEL = {
  cheque: 'Cheque',
  transfer: 'Bank transfer',
  standing_order: 'Standing order',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthLabel(isoDate) {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IL', { month: 'short', year: 'numeric' })
}

// One form for hand-entered expenses. With "Repeats every month" ticked it
// saves a recurring expense (rent…) that counts in every month from the
// start month to the end month; otherwise a one-time expense on its date.
// The recurring ones are listed under the form, where they can be ended or deleted.
export default function AddExpenseCard({ categories, recurring, recurringTableMissing }) {
  const router = useRouter()
  const [recurringOn, setRecurringOn] = useState(false)
  const [date, setDate] = useState(today())
  const [startMonth, setStartMonth] = useState(today().slice(0, 7))
  const [endMonth, setEndMonth] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('rent')
  const [paidBy, setPaidBy] = useState('cheque')
  const [includesVat, setIncludesVat] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const categoryLabel = Object.fromEntries(categories.map((c) => [c.value, c.label]))
  const ready =
    description.trim() && Number(amount) > 0 && !busy &&
    (recurringOn ? startMonth && (!endMonth || endMonth >= startMonth) : date)

  async function call(url, options) {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`)
      router.refresh()
      return true
    } catch (e) {
      setResult({ ok: false, error: e.message })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!ready) return
    const ok = recurringOn
      ? await call('/api/admin/recurring-expenses', {
          method: 'POST',
          body: JSON.stringify({
            name: description.trim(),
            amount: Number(amount),
            category,
            payment_method: paidBy,
            includes_vat: includesVat,
            start_month: startMonth,
            end_month: endMonth || null,
            notes: notes.trim() || null,
          }),
        })
      : await call('/api/admin/expenses', {
          method: 'POST',
          body: JSON.stringify({
            transaction_date: date,
            vendor: description.trim(),
            amount: Number(amount),
            category,
            paid_by: paidBy,
            notes: notes.trim() || null,
          }),
        })
    if (ok) {
      setResult({ ok: true, text: recurringOn ? 'Recurring expense saved' : 'Expense saved' })
      setAmount('')
      setDescription('')
      setNotes('')
    }
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

  return (
    <div className="card">
      <h2 className="section-h2">Add expense</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        For rent, bank transfers, cheques — anything not on a card statement. Tick &quot;Repeats every month&quot;
        for a fixed monthly cost like rent.
      </p>

      <form onSubmit={onSubmit} className="stack" style={{ gap: 10, marginTop: 12 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={recurringOn}
            onChange={(e) => setRecurringOn(e.target.checked)}
            disabled={busy || recurringTableMissing}
          />
          Repeats every month
          {recurringTableMissing && (
            <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
              (run section 19 of supabase-finance-schema.sql first)
            </span>
          )}
        </label>

        <div className="upload-grid">
          {recurringOn ? (
            <>
              <label className="upload-field">
                <span>Start month</span>
                <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={busy} required />
              </label>
              <label className="upload-field">
                <span>End month (optional)</span>
                <input
                  type="month"
                  value={endMonth}
                  min={startMonth}
                  onChange={(e) => setEndMonth(e.target.value)}
                  disabled={busy}
                />
              </label>
            </>
          ) : (
            <label className="upload-field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} required />
            </label>
          )}
          <label className="upload-field">
            <span>{recurringOn ? 'Amount per month (₪)' : 'Amount (₪)'}</span>
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
            disabled={busy} placeholder="e.g. Rent" required
          />
        </label>

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
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} disabled={busy}>
              {Object.entries(PAID_BY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {recurringOn && (
            <label className="upload-field">
              <span>VAT</span>
              <select value={includesVat ? 'yes' : 'no'} onChange={(e) => setIncludesVat(e.target.value === 'yes')} disabled={busy}>
                <option value="no">No VAT (e.g. private landlord)</option>
                <option value="yes">Amount includes VAT (tax invoice)</option>
              </select>
            </label>
          )}
        </div>

        <label className="upload-field">
          <span>Notes (optional)</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </label>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            {busy ? 'Saving…' : recurringOn ? 'Add recurring expense' : 'Add expense'}
          </button>
        </div>
      </form>

      {result && (
        <div className={`insight ${result.ok ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>
          <div className="insight-body">{result.ok ? `✓ ${result.text}` : `⚠ ${result.error}`}</div>
        </div>
      )}

      {recurring.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '20px 0 4px' }}>Recurring expenses</h3>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Counted in every month from the start month until the end month. To change an amount, set an end month
            and add a new one from the next month.
          </p>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
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
                {recurring.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>{categoryLabel[item.category] || item.category}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {ILS.format(item.amount)}/month
                    </td>
                    <td>{item.includes_vat ? 'Included' : 'No VAT'}</td>
                    <td>{PAID_BY_LABEL[item.payment_method] || item.payment_method}</td>
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
        </>
      )}
    </div>
  )
}
