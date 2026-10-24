'use client'

import { useState } from 'react'

// Monthly income without VAT: Store and Wolt as side-by-side columns, and their
// total as a line. Colors were checked with the dataviz palette validator
// (light surface, colorblind separation). The total line uses the ink color:
// it is the sum of the two columns, not a third category.
const STORE_COLOR = '#1a5f9e'
const WOLT_COLOR = '#de6f8e'
const TOTAL_COLOR = 'var(--fg)'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const W = 720
const H = 280
const M = { top: 16, right: 12, bottom: 30, left: 52 }
const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom
const BAR_MAX = 24
const BAR_GAP = 2
const MIN_WIDTH = 600

// Round the axis maximum up to 1, 2 or 5 × 10^n and return 4 even steps.
function niceTicks(max) {
  if (max <= 0) return [0, 1000, 2000, 3000, 4000]
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= raw)
  return [0, 1, 2, 3, 4].map((i) => i * step)
}

function compact(n) {
  return n >= 1000 ? `₪${Math.round(n / 1000)}K` : `₪${n}`
}

// Column with a 4px rounded top and a square base.
function columnPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// rows: oldest first, [{ month, label, store, wolt, inProgress }]; store and
// wolt are numbers without VAT, or null when not uploaded.
export default function IncomeChart({ rows }) {
  const [active, setActive] = useState(null)

  const totals = rows.map((r) => (r.store != null && r.wolt != null ? r.store + r.wolt : null))
  const max = Math.max(0, ...rows.flatMap((r, i) => [r.store || 0, r.wolt || 0, totals[i] || 0]))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const y = (v) => M.top + PLOT_H - (v / top) * PLOT_H

  const slot = PLOT_W / Math.max(rows.length, 1)
  const barW = Math.min(BAR_MAX, (slot * 0.7 - BAR_GAP) / 2)
  const cx = (i) => M.left + slot * i + slot / 2

  // The total line breaks where a month is missing Store or Wolt.
  const segments = []
  let seg = []
  totals.forEach((t, i) => {
    if (t == null) {
      if (seg.length) segments.push(seg)
      seg = []
    } else {
      seg.push([cx(i), y(t)])
    }
  })
  if (seg.length) segments.push(seg)

  const a = active != null ? rows[active] : null

  return (
    <div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: '0.85rem', marginBottom: 8 }}>
        <LegendItem swatch={<rect width="12" height="12" rx="2" fill={STORE_COLOR} />} label="Store" />
        <LegendItem swatch={<rect width="12" height="12" rx="2" fill={WOLT_COLOR} />} label="Wolt (after fees)" />
        <LegendItem
          swatch={<line x1="0" y1="6" x2="14" y2="6" stroke={TOTAL_COLOR} strokeWidth="2" strokeLinecap="round" />}
          label="Total income"
        />
      </div>

      {/* Below this width the labels get too small, so the chart scrolls sideways instead. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', minWidth: MIN_WIDTH }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="Monthly income without VAT: Store and Wolt columns, total income line"
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

            {rows.map((r, i) => {
              const x0 = cx(i) - barW - BAR_GAP / 2
              const x1 = cx(i) + BAR_GAP / 2
              const missing = r.store == null || r.wolt == null
              return (
                <g key={r.month} opacity={active != null && active !== i ? 0.55 : 1}>
                  {active === i && (
                    <rect x={M.left + slot * i} y={M.top} width={slot} height={PLOT_H} fill="var(--bg)" />
                  )}
                  {r.store != null && r.store > 0 && (
                    <path d={columnPath(x0, y(r.store), barW, y(0) - y(r.store))} fill={STORE_COLOR} />
                  )}
                  {r.wolt != null && r.wolt > 0 && (
                    <path d={columnPath(x1, y(r.wolt), barW, y(0) - y(r.wolt))} fill={WOLT_COLOR} />
                  )}
                  <text x={cx(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--fg-muted)">
                    {r.label}
                  </text>
                  {missing && !r.inProgress && (
                    <text x={cx(i)} y={H} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--warning)">
                      missing
                    </text>
                  )}
                </g>
              )
            })}

            {segments.map((s, i) => (
              <polyline
                key={i}
                points={s.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke={TOTAL_COLOR}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {totals.map((t, i) =>
              t == null ? null : (
                <circle key={i} cx={cx(i)} cy={y(t)} r="4" fill={TOTAL_COLOR} stroke="var(--bg-card)" strokeWidth="2" />
              ),
            )}

            {/* Hit targets: the whole month slot, so the pointer never has to land on a thin mark. */}
            {rows.map((r, i) => (
              <rect
                key={r.month}
                x={M.left + slot * i}
                y={M.top}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${r.label}: Store ${fmt(r.store)}, Wolt ${fmt(r.wolt)}, total ${fmt(totals[i])}`}
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
              <TooltipRow color={STORE_COLOR} label="Store" value={a.store} />
              <TooltipRow color={WOLT_COLOR} label="Wolt" value={a.wolt} />
              <TooltipRow color={TOTAL_COLOR} label="Total" value={totals[active]} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function fmt(v) {
  return v == null ? 'missing' : ILS.format(v)
}

function LegendItem({ swatch, label }) {
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
      <svg width="14" height="12" aria-hidden="true">{swatch}</svg>
      <span>{label}</span>
    </span>
  )
}

function TooltipRow({ color, label, value }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
        <svg width="12" height="4" aria-hidden="true">
          <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="muted">{label}</span>
      </span>
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</strong>
    </div>
  )
}
