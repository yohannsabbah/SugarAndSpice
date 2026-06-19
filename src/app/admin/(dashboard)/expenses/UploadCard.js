'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

export default function ExpenseUploadCard() {
  const router = useRouter()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const formRef = useRef(null)

  const ready = file && !busy

  async function onSubmit(e) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('source', 'max_xlsx')
    try {
      const res = await fetch('/api/admin/expenses/upload', { method: 'POST', body: fd })
      const json = await res.json()
      setResult({ ok: res.ok, ...json })
      if (res.ok) {
        setFile(null)
        formRef.current?.reset()
        router.refresh()
      }
    } catch (err) {
      setResult({ ok: false, error: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Upload statement (MAX .xlsx)</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Drag in a transaction-details export from the MAX portal. Re-uploading the same
        file is safe — duplicates are skipped by hash.
      </p>
      <form ref={formRef} onSubmit={onSubmit} className="stack" style={{ gap: 12 }}>
        <label className="upload-field">
          <span>Statement file</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={busy}
          />
          {file && (
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              {file.name} ({Math.round(file.size / 1024)} KB)
            </span>
          )}
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.5 }}>
            {busy ? 'Uploading…' : 'Upload & process'}
          </button>
        </div>
      </form>

      {result && <ResultBanner result={result} />}
    </div>
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
        </div>
      </div>
    )
  }
  const recOk = result.reconciled !== false
  return (
    <div className={`insight ${recOk ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}>
      <div className="insight-title">
        {recOk ? '✓' : '⚠'} {result.period_label} imported · {result.cards?.join(', ')}
      </div>
      <div className="insight-body">
        {result.inserted} new · {result.skipped} skipped (already in DB) · total {ILS.format(result.total_amount || 0)}
        {result.reconciled === false && (
          <div style={{ color: 'var(--danger)', marginTop: 4 }}>
            Reconciliation mismatch: parsed sum {ILS.format(result.parsed_sum)} vs file total {ILS.format(result.total_amount)}
          </div>
        )}
      </div>
    </div>
  )
}
