'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ManualEntryCard({ categories, paymentMethods }) {
  const router = useRouter()
  const [date, setDate] = useState(today())
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('rent')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const ready = date && vendor.trim() && Number(amount) > 0 && category && !busy

  async function onSubmit(e) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_date: date,
          vendor: vendor.trim(),
          amount: Number(amount),
          category,
          payment_method_id: paymentMethodId || null,
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult({ ok: true, id: json.id })
        setVendor(''); setAmount(''); setNotes('')
        router.refresh()
      } else {
        setResult({ ok: false, error: json.error || 'Failed' })
      }
    } catch (err) {
      setResult({ ok: false, error: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Add expense manually</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        For rent, salaries, bank transfers — anything not on a credit-card statement.
      </p>
      <form onSubmit={onSubmit} className="stack" style={{ gap: 10 }}>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} required />
          </label>
          <label className="upload-field">
            <span>Amount (₪)</span>
            <input
              type="number" step="0.01" min="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              disabled={busy} placeholder="0.00" required
            />
          </label>
        </div>
        <label className="upload-field">
          <span>Vendor / description</span>
          <input
            type="text"
            value={vendor} onChange={(e) => setVendor(e.target.value)}
            disabled={busy} placeholder="e.g. Rent — May 2026" required
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
            <span>Payment method</span>
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} disabled={busy}>
              <option value="">— Optional —</option>
              {paymentMethods.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="upload-field">
          <span>Notes (optional)</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Add expense'}
          </button>
        </div>
      </form>
      {result && (
        <div className={`insight ${result.ok ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>
          <div className="insight-body">
            {result.ok ? '✓ Saved' : `⚠ ${result.error}`}
          </div>
        </div>
      )}
    </div>
  )
}
