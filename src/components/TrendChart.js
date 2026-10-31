'use client'

import { useState } from 'react'
import { compact, niceTicks } from './chartScale'

// Revenue per month, one line per series (categories or items).
// Each series brings its color from SERIES_COLORS in chartScale.js.

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const W = 720
const H = 280
const M = { top: 16, right: 12, bottom: 34, left: 52 }
const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom
const MIN_WIDTH = 600
const DASH = '6 4'

// months: oldest first, [{ month, label, inProgress, hasData }].
// series: [{ key, label, color, dashed, values }], values[i] is the revenue for
// months[i], or null when that month has no item data.
export default function TrendChart({ months, series, ariaLabel }) {
  const [active, setActive] = useState(null)
  const [focus, setFocus] = useState(null)

  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0)))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const y = (v) => M.top + PLOT_H - (v / top) * PLOT_H
  const slot = PLOT_W / Math.max(months.length, 1)
  const cx = (i) => M.left + slot * i + slot / 2

  // A line breaks where a month has no data.
  const segmentsOf = (values) => {
    const segments = []
    let seg = []
    values.forEach((v, i) => {
      if (v == null) {
        if (seg.length) segments.push(seg)
        seg = []
      } else {
        seg.push([cx(i), y(v)])
      }
    })
    if (seg.length) segments.push(seg)
    return segments
  }

  const dim = (key) => focus != null && focus !== key
  const a = active != null ? months[active] : null
  const tooltipRows = a
    ? series
        .map((s) => ({ ...s, value: s.values[active] }))
        .sort((p, q) => (q.value ?? -1) - (p.value ?? -1))
    : []

  return (
    <div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: '0.85rem', marginBottom: 8 }}>
        {series.map((s) => (
          <span
            key={s.key}
            className="row"
            style={{ gap: 6, alignItems: 'center', cursor: 'default', opacity: dim(s.key) ? 0.45 : 1 }}
            onMouseEnter={() => setFocus(s.key)}
            onMouseLeave={() => setFocus(null)}
          >
            <svg width="16" height="12" aria-hidden="true">
              <line x1="0" y1="6" x2="16" y2="6" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            <span>{s.label}</span>
          </span>
        ))}
      </div>

      {/* Below this width the labels get too small, so the chart scrolls sideways instead. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', minWidth: MIN_WIDTH }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={ariaLabel}
            style={{ display: 'block', overflow: 'visible' }}
            onMouseLeave={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                <text
                  x={M.left - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="var(--fg-muted)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {compact(t)}
                </text>
              </g>
            ))}

            {months.map((m, i) => (
              <g key={m.month}>
                <text x={cx(i)} y={H - 16} textAnchor="middle" fontSize="11" fill="var(--fg-muted)">
                  {m.label}
                </text>
                {(m.inProgress || !m.hasData) && (
                  <text
                    x={cx(i)}
                    y={H - 3}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill={m.inProgress ? 'var(--fg-muted)' : 'var(--warning)'}
                  >
                    {m.inProgress ? 'in progress' : 'no data'}
                  </text>
                )}
              </g>
            ))}

            {active != null && (
              <line x1={cx(active)} x2={cx(active)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--fg-muted)" strokeWidth="1" />
            )}

            {series.map((s) => (
              <g key={s.key} opacity={dim(s.key) ? 0.15 : 1}>
                {segmentsOf(s.values).map((seg, i) => (
                  <polyline
                    key={i}
                    points={seg.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2"
                    strokeDasharray={s.dashed ? DASH : undefined}
                    strokeLinejoin="round"
                    strokeLinecap={s.dashed ? 'butt' : 'round'}
                  />
                ))}
                {/* A marker on the hovered month, and on any point with no neighbor to draw a line to. */}
                {s.values.map((v, i) => {
                  const alone = s.values[i - 1] == null && s.values[i + 1] == null
                  if (v == null || (i !== active && !alone)) return null
                  return <circle key={i} cx={cx(i)} cy={y(v)} r="4" fill={s.color} stroke="var(--bg-card)" strokeWidth="2" />
                })}
              </g>
            ))}

            {/* Hit targets: the whole month slot, so the pointer never has to land on a thin line. */}
            {months.map((m, i) => (
              <rect
                key={m.month}
                x={M.left + slot * i}
                y={M.top}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${m.label}: ${series.map((s) => `${s.label} ${fmt(s.values[i])}`).join(', ')}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ outline: 'none' }}
              />
            ))}
          </svg>

          {a && (
            <div
              role="status"
              style={{
                position: 'absolute',
                top: 0,
                left: `${(cx(active) / W) * 100}%`,
                transform: cx(active) > W / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                boxShadow: 'var(--shadow)',
                padding: '8px 10px',
                fontSize: '0.8rem',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <div className="muted" style={{ marginBottom: 4 }}>
                {a.label}
                {a.inProgress ? ' · in progress' : ''}
              </div>
              {tooltipRows.map((s) => (
                <div key={s.key} className="row" style={{ gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <svg width="14" height="4" aria-hidden="true">
                      <line x1="0" y1="2" x2="14" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 2' : undefined} />
                    </svg>
                    <span className="muted">{s.label}</span>
                  </span>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.value)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function fmt(v) {
  return v == null ? 'no data' : ILS.format(v)
}
