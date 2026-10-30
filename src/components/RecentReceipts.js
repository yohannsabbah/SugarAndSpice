'use client'

import { useEffect, useState } from 'react'
import { formatDateTime } from '@/lib/format'

// The last uploads, newest first, so the employee sees that the photo arrived
// and does not upload the same paper twice. refreshKey: change it to reload.
export default function RecentReceipts({ refreshKey }) {
  const [receipts, setReceipts] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/receipts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return
        setReceipts(d.receipts)
        setError(false)
      })
      .catch((e) => {
        console.warn('Could not load recent receipts:', e)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (error && !receipts) return <div className="muted recent-receipts-empty">Could not load the last receipts.</div>
  if (!receipts) return <div className="muted recent-receipts-empty">Loading the last receipts…</div>
  if (receipts.length === 0) return <div className="muted recent-receipts-empty">No receipts yet.</div>

  return (
    <div className="recent-receipts">
      <div className="recent-receipts-title">Last receipts</div>
      <ul className="recent-receipts-list">
        {receipts.map((r) => (
          <li key={r.id} className="recent-receipts-row">
            <a href={r.imageUrl} target="_blank" rel="noreferrer" title="Open the photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed S3 link, not a static asset */}
              <img className="recent-receipts-thumb" src={r.imageUrl} alt="Receipt photo" loading="lazy" />
            </a>
            <span className="recent-receipts-name">{r.uploaderName || 'Unknown'}</span>
            <span className="muted">{formatDateTime(r.uploadedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
