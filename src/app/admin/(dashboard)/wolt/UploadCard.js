'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// bare: skip the outer card/heading — used when an ancestor (e.g. a
// collapsible section combining upload + file-status) already provides them.
export default function UploadCard({ bare = false }) {
  const router = useRouter()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  function onFilesChange(e) {
    setFiles([...(e.target.files || [])])
    setResults(null)
    setError(null)
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!files.length || busy) return
    setBusy(true)
    setResults(null)
    setError(null)
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    try {
      const res = await fetch('/api/admin/wolt/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Upload failed')
      } else {
        setResults(json.results)
        router.refresh()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setFiles([])
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const body = (
    <>
      {!bare && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Drop any mix of Wolt PDFs (invoices, netting, sales reports) and CSVs (items, purchases) —
          any period, any order, any time. Each file is identified automatically.
        </p>
      )}
      <form onSubmit={onSubmit} className="stack" style={{ gap: 12 }}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.csv"
          onChange={onFilesChange}
          disabled={busy}
        />
        {files.length > 0 && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {files.length} file{files.length > 1 ? 's' : ''} selected
          </span>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!files.length || busy}>
            {busy ? 'Uploading…' : 'Upload & process'}
          </button>
        </div>
      </form>

      {error && (
        <div className="insight bad" style={{ marginTop: 12 }}>
          <div className="insight-title">⚠ Upload failed</div>
          <div className="insight-body">{error}</div>
        </div>
      )}

      {results && <ResultsList results={results} />}
    </>
  )

  if (bare) return body

  return (
    <div className="card">
      <h2 className="section-h2">Upload Wolt files</h2>
      {body}
    </div>
  )
}

function ResultsList({ results }) {
  const anyError = results.some((r) => r.status === 'error')
  return (
    <div className={`insight ${anyError ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
      <div className="insight-title">
        {anyError ? '⚠' : '✓'} {results.length} file{results.length > 1 ? 's' : ''} processed
      </div>
      <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, fontSize: '0.8rem' }}>
        {results.map((r, i) => (
          <li key={i} style={{ color: r.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
            {r.status === 'ok' ? '✓' : '✗'} {r.filename} ({r.detected_type}) — {r.detail}
          </li>
        ))}
      </ul>
    </div>
  )
}
