'use client'

import { useState } from 'react'
import { netAmount, summarizeReceipts } from '@/lib/receipts/money'
import { breakdown, vendorKey } from '@/lib/receipts/breakdown'
import { RECEIPT_CATEGORIES, categoryLabel } from '@/lib/receipts/categories'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = new Intl.NumberFormat('en-IL', { style: 'percent', maximumFractionDigits: 0 })

// The dataviz reference palette (light), in its fixed, validated order. Gray
// is for "Other" and "Uncategorized", which are not categories of their own.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const GRAY = '#a3a29a'

// A category keeps its color from month to month: the color follows its
// place in RECEIPT_CATEGORIES, not its rank.
function categoryColor(key) {
  const i = RECEIPT_CATEGORIES.indexOf(key)
  return key && key !== 'other' && i < SERIES.length ? SERIES[i] : GRAY
}

// Month totals and the two pies. Reads the table's rows, so an edit shows here at once.
export default function ReceiptsSummary({ rows }) {
  const s = summarizeReceipts(rows)
  const missing = rows.filter((r) => !r.duplicate_of && (r.total === null || r.total === undefined)).length

  const byCategory = breakdown(rows, (r) => r.category).map((x) => ({
    ...x,
    label: x.other ? 'Other' : categoryLabel(x.key),
    color: x.other ? GRAY : categoryColor(x.key),
  }))
  // Vendors change from month to month, so their colors go by rank. The
  // unknown vendor is gray and does not use up a color.
  const vendors = breakdown(rows, vendorKey)
  const named = vendors.filter((x) => x.key && !x.other)
  const byVendor = vendors.map((x) => ({
    ...x,
    label: x.other ? 'Other vendors' : x.key || 'Unknown vendor',
    color: x.other || !x.key ? GRAY : SERIES[named.indexOf(x)],
  }))

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="kpi-row">
        <div className="card kpi">
          <div className="kpi-label">Total for the month</div>
          <div className="kpi-value">{ILS.format(s.total)}</div>
          <div className="kpi-subtitle">
            {s.count} receipt{s.count === 1 ? '' : 's'}
            {missing > 0 && ` · ${missing} without an amount`}
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">VAT</div>
          <div className="kpi-value">{ILS.format(s.vat)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Net (without VAT)</div>
          <div className="kpi-value">{ILS.format(netAmount(s.total, s.vat))}</div>
        </div>
      </div>

      {s.total > 0 && (
        <div className="receipts-pies">
          <Pie title="By category" slices={byCategory} total={s.total} />
          <Pie title="By vendor" slices={byVendor} total={s.total} />
        </div>
      )}
    </div>
  )
}

const R = 70
const INNER = 44
const SIZE = 2 * R + 8

function point(r, angle) {
  return [SIZE / 2 + r * Math.sin(angle), SIZE / 2 - r * Math.cos(angle)]
}

// One donut ring segment from angle a0 to a1 (radians, clockwise from 12 o'clock).
function arcPath(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = point(R, a0)
  const [x1, y1] = point(R, a1)
  const [x2, y2] = point(INNER, a1)
  const [x3, y3] = point(INNER, a0)
  return `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${INNER},${INNER} 0 ${large} 0 ${x3},${y3}Z`
}

function Pie({ title, slices, total }) {
  const [active, setActive] = useState(null)
  const turn = (n) => (n / total) * 2 * Math.PI
  const arcs = slices.map((sl, i) => {
    const a0 = turn(slices.slice(0, i).reduce((sum, x) => sum + x.total, 0))
    return { ...sl, a0, a1: a0 + turn(sl.total) }
  })
  const a = active !== null ? arcs[active] : null

  return (
    <div className="card receipts-pie">
      <h2 className="section-h2" style={{ marginBottom: 12 }}>{title}</h2>
      <div className="receipts-pie-body">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`Receipts ${title.toLowerCase()}: ${slices.map((x) => `${x.label} ${ILS.format(x.total)}`).join(', ')}`}
          onMouseLeave={() => setActive(null)}
          style={{ flex: 'none' }}
        >
          {arcs.length === 1 ? (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={(R + INNER) / 2} fill="none" stroke={arcs[0].color} strokeWidth={R - INNER} />
          ) : (
            arcs.map((x, i) => (
              <path
                key={i}
                d={arcPath(x.a0, x.a1)}
                fill={x.color}
                stroke="var(--bg-card)"
                strokeWidth="2"
                strokeLinejoin="round"
                opacity={active !== null && active !== i ? 0.45 : 1}
                onMouseEnter={() => setActive(i)}
              >
                <title>{`${x.label}: ${ILS.format(x.total)}`}</title>
              </path>
            ))
          )}
          <text x={SIZE / 2} y={SIZE / 2 - 6} textAnchor="middle" fontSize="10" fill="var(--fg-muted)">
            {a ? a.label.slice(0, 14) : 'Total'}
          </text>
          <text x={SIZE / 2} y={SIZE / 2 + 10} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--fg)" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ILS.format(a ? a.total : total)}
          </text>
        </svg>

        <ul className="receipts-legend">
          {arcs.map((x, i) => (
            <li
              key={i}
              className={active === i ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="receipts-swatch" style={{ background: x.color }} />
              <span className="receipts-legend-label" dir="auto">{x.label}</span>
              <span className="num">{ILS.format(x.total)}</span>
              <span className="muted num receipts-legend-pct">{PCT.format(x.total / total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
