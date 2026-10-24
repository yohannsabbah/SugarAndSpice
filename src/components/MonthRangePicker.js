'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Start/end month inputs that write ?from= and ?to= to the URL.
// `min` and `max` bound the range. The default range is `defaultFrom` → `max`.
// All values are 'YYYY-MM'. `defaultLabel` names the reset button.
export default function MonthRangePicker({ from, to, defaultFrom, min, max, defaultLabel }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const isDefaultRange = from === defaultFrom && to === max

  function go(nextFrom, nextTo) {
    // Keep the range in order if the user picks a start after the end.
    if (nextFrom > nextTo) [nextFrom, nextTo] = [nextTo, nextFrom]
    const params = new URLSearchParams(Array.from(search.entries()))
    if (nextFrom === defaultFrom) params.delete('from')
    else params.set('from', nextFrom)
    if (nextTo === max) params.delete('to')
    else params.set('to', nextTo)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const inputStyle = { width: 'auto', minWidth: 150, padding: '6px 10px', fontSize: '0.9rem' }

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <label className="row muted" style={{ gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
        From
        <input
          type="month"
          className="input"
          value={from}
          min={min}
          max={max}
          onChange={(e) => e.target.value && go(e.target.value, to)}
          style={inputStyle}
        />
      </label>
      <label className="row muted" style={{ gap: 6, fontSize: '0.85rem', fontWeight: 600 }}>
        To
        <input
          type="month"
          className="input"
          value={to}
          min={min}
          max={max}
          onChange={(e) => e.target.value && go(from, e.target.value)}
          style={inputStyle}
        />
      </label>
      {!isDefaultRange && (
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          onClick={() => go(defaultFrom, max)}
        >
          {defaultLabel}
        </button>
      )}
    </div>
  )
}
