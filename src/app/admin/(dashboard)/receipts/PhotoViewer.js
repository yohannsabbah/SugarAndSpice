'use client'

import { useEffect, useState } from 'react'

const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The receipt photo over the page, so the owner checks a row without leaving
// it. Click the photo to zoom, Esc or a click outside closes, arrow keys move
// to the previous or next receipt.
export default function PhotoViewer({ row, position, onPrev, onNext, onClose }) {
  const [zoomed, setZoomed] = useState(false)
  const [lastId, setLastId] = useState(row.id)
  if (row.id !== lastId) {
    setLastId(row.id)
    setZoomed(false)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onPrev, onNext, onClose])

  const caption = [row.vendor, row.purchased_at, row.total === null || row.total === undefined ? null : ILSp.format(row.total)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="receipt-viewer" role="dialog" aria-modal="true" aria-label="Receipt photo" onClick={onClose}>
      <div className="receipt-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="receipt-viewer-btn" disabled={!onPrev} onClick={onPrev || undefined}>
          ← Previous
        </button>
        <button type="button" className="receipt-viewer-btn" disabled={!onNext} onClick={onNext || undefined}>
          Next →
        </button>
        <span className="grow" dir="auto">{caption || 'Not read yet'}</span>
        <span style={{ opacity: 0.7 }}>{position}</span>
        <button type="button" className="receipt-viewer-btn" onClick={() => setZoomed((z) => !z)}>
          {zoomed ? 'Fit' : 'Zoom'}
        </button>
        <button type="button" className="receipt-viewer-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className={`receipt-viewer-stage ${zoomed ? 'zoom' : 'fit'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed S3 link, not a static asset */}
        <img
          src={row.imageUrl}
          alt="Receipt photo"
          onClick={(e) => {
            e.stopPropagation()
            setZoomed((z) => !z)
          }}
        />
      </div>
    </div>
  )
}
