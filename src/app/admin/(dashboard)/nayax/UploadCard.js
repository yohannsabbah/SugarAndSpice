'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

// Default to the current month in YYYY-MM.
function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function UploadCard() {
  const router = useRouter()
  const [month, setMonth] = useState(thisMonth())
  const [hourly, setHourly] = useState(null)
  const [items, setItems] = useState(null)
  const [payments, setPayments] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, summary, checks, error }
  const formRef = useRef(null)

  const ready = hourly && items && payments && /^\d{4}-\d{2}$/.test(month) && !busy

  async function onSubmit(e) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setResult(null)
    const fd = new FormData()
    fd.append('month', month)
    fd.append('hourly', hourly)
    fd.append('items', items)
    fd.append('payments', payments)
    try {
      const res = await fetch('/api/admin/nayax/upload', { method: 'POST', body: fd })
      const json = await res.json()
      setResult({ ok: res.ok, ...json })
      if (res.ok) {
        // Refresh server data so the dashboard reflects the new month.
        router.refresh()
        // Clear file inputs but keep the month + result message visible.
        setHourly(null); setItems(null); setPayments(null)
        formRef.current?.reset()
      }
    } catch (err) {
      setResult({ ok: false, error: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Upload monthly CSVs</h2>
      <form ref={formRef} onSubmit={onSubmit} className="stack" style={{ gap: 12 }}>
        <div className="upload-grid">
          <label className="upload-field">
            <span>Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={busy}
            />
          </label>
          <FileField label="Hourly CSV" file={hourly} onChange={setHourly} disabled={busy} />
          <FileField label="Items CSV" file={items} onChange={setItems} disabled={busy} />
          <FileField label="Payments CSV" file={payments} onChange={setPayments} disabled={busy} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!ready}
            style={{ opacity: ready ? 1 : 0.5 }}
          >
            {busy ? 'Uploading…' : 'Upload & process'}
          </button>
        </div>
      </form>

      {result && <ResultBanner result={result} />}
    </div>
  )
}

function FileField({ label, file, onChange, disabled }) {
  return (
    <label className="upload-field">
      <span>{label}</span>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        disabled={disabled}
      />
      {file && (
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {file.name} ({Math.round(file.size / 1024)} KB)
        </span>
      )}
    </label>
  )
}

function ResultBanner({ result }) {
  if (!result.ok) {
    return (
      <div className="insight bad" style={{ marginTop: 12 }}>
        <div className="insight-title">⚠ Upload failed</div>
        <div className="insight-body">
          {result.error || 'Unknown error'}
          {result.hint && <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Hint: {result.hint}</div>}
          {result.checks && <ChecksList checks={result.checks} />}
        </div>
      </div>
    )
  }
  const s = result.summary
  const anyMismatch = result.checks?.some((c) => !c.ok)
  return (
    <div className={`insight ${anyMismatch ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
      <div className="insight-title">
        {anyMismatch ? '⚠' : '✓'} {result.period_month?.slice(0, 7)} imported
      </div>
      <div className="insight-body">
        {s.orders} orders · {ILS.format(s.net)} net · {s.items} items · {s.methods} payment methods
        {result.checks && <ChecksList checks={result.checks} />}
      </div>
    </div>
  )
}

function ChecksList({ checks }) {
  return (
    <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, fontSize: '0.8rem' }}>
      {checks.map((c, i) => (
        <li key={i} style={{ color: c.ok ? 'var(--success)' : 'var(--danger)' }}>
          {c.ok ? '✓' : '✗'} {c.label}: {c.a} vs {c.b}
        </li>
      ))}
    </ul>
  )
}
