'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

function ymToDate(ym) {
  if (!ym) return new Date()
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

function dateToYm(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthPicker({ value }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const now = new Date()
  const selected = value || dateToYm(now)
  const selectedDate = ymToDate(selected)
  const isCurrent = dateToYm(now) === selected
  const label = selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  function go(ym) {
    const params = new URLSearchParams(Array.from(search.entries()))
    if (ym === dateToYm(now)) {
      params.delete('month')
    } else {
      params.set('month', ym)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function shift(delta) {
    const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1)
    go(dateToYm(d))
  }

  function onSelect(e) {
    go(e.target.value)
  }

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        flexWrap: 'wrap',
      }}
    >
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-ghost"
          style={{ padding: '8px 12px', fontSize: '0.9rem' }}
          onClick={() => shift(-1)}
          aria-label="Previous month"
        >
          ←
        </button>
        <input
          type="month"
          className="input"
          value={selected}
          onChange={onSelect}
          style={{ width: 'auto', minWidth: 160 }}
          max={dateToYm(now)}
        />
        <button
          className="btn btn-ghost"
          style={{ padding: '8px 12px', fontSize: '0.9rem' }}
          onClick={() => shift(1)}
          aria-label="Next month"
          disabled={selectedDate >= new Date(now.getFullYear(), now.getMonth(), 1)}
        >
          →
        </button>
        {!isCurrent && (
          <button
            className="btn btn-pink"
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => go(dateToYm(now))}
          >
            This month
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: '0.95rem', fontWeight: 600 }}>
        Showing: <span style={{ color: 'var(--brand-blue-dark)' }}>{label}</span>
      </div>
    </div>
  )
}
