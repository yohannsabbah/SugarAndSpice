import { listNayaxPeriods, getNayaxPeriodDetail } from '@/lib/db/nayax'
import UploadCard from './UploadCard'
import '../wolt/wolt.css'
import './nayax.css'

export const dynamic = 'force-dynamic'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`

// Payment-method display: nicer label + brand color for the bar chart.
const METHOD_DISPLAY = {
  cash:       { label: 'Cash',       color: '#7aa17a' },
  visa:       { label: 'Visa',       color: '#1a1f71' },
  mastercard: { label: 'Mastercard', color: '#eb001b' },
  amex:       { label: 'Amex',       color: '#2e77bb' },
  diners:     { label: 'Diners',     color: '#6c6c6c' },
  other:      { label: 'Other',      color: '#999' },
}
const METHOD_ORDER = ['cash', 'visa', 'mastercard', 'amex', 'diners', 'other']

function monthLabelOf(periodMonth) {
  return new Date(periodMonth).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}

export default async function NayaxPage({ searchParams }) {
  const sp = await searchParams
  const monthParam = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null

  let allPeriods
  try {
    allPeriods = await listNayaxPeriods()
  } catch (err) {
    if (err.missingSchema) return <SchemaMissingState />
    return <ErrorState error={err} />
  }
  if (!allPeriods.length) return <EmptyState />

  // Default to the latest month present in data unless explicitly selected.
  const latest = allPeriods[0]
  const selectedMonth = monthParam || latest.period_month.slice(0, 7)
  const selectedMonthDate = `${selectedMonth}-01`
  const cur = allPeriods.find((p) => p.period_month.slice(0, 7) === selectedMonth) || null

  if (!cur) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="card">
          <h2 className="section-h2">No in-store data for {monthLabelOf(selectedMonthDate)}</h2>
          <p className="muted">Upload the 3 CSVs for that month below, or pick a different month.</p>
        </div>
        <UploadCard />
      </div>
    )
  }

  // Previous month for comparisons (just calendar -1, not "previous loaded").
  const [py, pm] = selectedMonth.split('-').map(Number)
  const prevDate = new Date(py, pm - 2, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
  const prv = allPeriods.find((p) => p.period_month.slice(0, 7) === prevMonth) || null

  const detail = await getNayaxPeriodDetail(cur.id)

  const monthLabel = monthLabelOf(cur.period_month)
  const prevMonthLabel = monthLabelOf(`${prevMonth}-01`)

  // ── KPI derivations ─────────────────────────────────────────────────────
  const deltaPct = (a, b) => (b == null || b === 0 ? null : ((a || 0) - (b || 0)) / b)
  const dNet     = deltaPct(Number(cur.net_incl_vat),  prv ? Number(prv.net_incl_vat) : null)
  const dOrders  = deltaPct(Number(cur.total_orders),  prv ? Number(prv.total_orders) : null)
  const dAvg     = deltaPct(Number(cur.avg_ticket),    prv ? Number(prv.avg_ticket)   : null)

  const cashRow = detail.payments.find((p) => p.method === 'cash')
  const cashShare = cur.net_incl_vat ? Number(cashRow?.net_incl_vat || 0) / Number(cur.net_incl_vat) : null

  // ── Reconciliation: items-revenue vs payments-net ───────────────────────
  const itemsRev = detail.items.reduce((s, i) => s + Number(i.revenue_incl_vat || 0), 0)
  const reconGap = Math.abs(itemsRev - Number(cur.net_incl_vat || 0))
  const reconOk = reconGap < 1 // within rounding

  // ── Top items (already sorted by revenue desc in the DB query) ──────────
  const topItems = detail.items.slice(0, 20).map((it) => ({
    item_name: it.item_name,
    category: it.items?.category || null,
    units_sold: it.units_sold,
    revenue_incl_vat: Number(it.revenue_incl_vat),
  }))

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>In-store — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {allPeriods.length} month{allPeriods.length > 1 ? 's' : ''} of data loaded
        </span>
      </div>

      {!reconOk && (
        <div className="insight bad">
          <div className="insight-title">⚠ Reconciliation mismatch</div>
          <div className="insight-body">
            Items CSV totals <b>{ILSp.format(itemsRev)}</b> but payments CSV says net is <b>{ILSp.format(cur.net_incl_vat)}</b>
            {' '}— off by <b>{ILSp.format(reconGap)}</b>. Check that all 3 CSVs are from the same month.
          </div>
        </div>
      )}

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="kpi-row">
        <KPI
          label="Net revenue"
          value={ILS.format(Number(cur.net_incl_vat || 0))}
          subtitle={cur.refunds_incl_vat > 0 ? `after ${ILS.format(cur.refunds_incl_vat)} refunds` : null}
          delta={dNet}
          deltaSuffix={`vs ${prevMonthLabel}`}
        />
        <KPI
          label="Orders"
          value={cur.total_orders ?? '—'}
          subtitle={cur.units_sold ? `${cur.units_sold} items (${(cur.units_sold / cur.total_orders).toFixed(1)}/order)` : null}
          delta={dOrders}
          deltaSuffix={`vs ${prevMonthLabel}`}
        />
        <KPI
          label="Avg ticket"
          value={ILSp.format(Number(cur.avg_ticket || 0))}
          delta={dAvg}
          deltaSuffix={`vs ${prevMonthLabel}`}
        />
        <KPI
          label="Cash share"
          value={cashShare != null ? PCT(cashShare) : '—'}
          subtitle={cashRow ? `${cashRow.orders} cash orders` : null}
        />
      </div>

      {/* ── Hourly chart ─────────────────────────────────────────────────── */}
      <HourlyCard hours={detail.hours} monthLabel={monthLabel} />

      {/* ── Payments + Categories side by side ──────────────────────────── */}
      <div className="grid-2">
        <PaymentsCard payments={detail.payments} totalNet={Number(cur.net_incl_vat || 0)} />
        <CategoriesCard categories={detail.categories} />
      </div>

      {/* ── Top items ────────────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">Top items — {monthLabel}</h2>
        {topItems.length ? <TopItems items={topItems} /> : <p className="muted">No item data.</p>}
      </div>

      {/* ── Upload more months ──────────────────────────────────────────── */}
      <UploadCard />

      {/* ── Monthly history (if more than one month loaded) ─────────────── */}
      {allPeriods.length > 1 && (
        <div className="card">
          <h2 className="section-h2">Monthly history</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Orders</th>
                <th style={{ textAlign: 'right' }}>Gross</th>
                <th style={{ textAlign: 'right' }}>Refunds</th>
                <th style={{ textAlign: 'right' }}>Net</th>
                <th style={{ textAlign: 'right' }}>Avg ticket</th>
              </tr>
            </thead>
            <tbody>
              {allPeriods.map((p) => {
                const isCurrent = p.period_month.slice(0, 7) === selectedMonth
                return (
                  <tr key={p.id} style={isCurrent ? { background: 'var(--brand-pink-bg)' } : null}>
                    <td style={{ fontWeight: isCurrent ? 700 : 500 }}>{monthLabelOf(p.period_month)}</td>
                    <td className="num">{p.total_orders}</td>
                    <td className="num">{ILS.format(Number(p.gross_incl_vat || 0))}</td>
                    <td className="num">{p.refunds_incl_vat > 0 ? `−${ILS.format(p.refunds_incl_vat)}` : '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{ILS.format(Number(p.net_incl_vat || 0))}</td>
                    <td className="num">{ILSp.format(Number(p.avg_ticket || 0))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── components ──────────────────────────────────────────────────────────────
function KPI({ label, value, subtitle, delta, deltaSuffix = 'vs prev', tone }) {
  return (
    <div className={`card kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
      {delta != null && (
        <div className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}% {deltaSuffix}
        </div>
      )}
    </div>
  )
}

function HourlyCard({ hours, monthLabel }) {
  if (!hours.length) {
    return (
      <div className="card"><h2 className="section-h2">By hour — {monthLabel}</h2>
        <p className="muted">No hourly data.</p>
      </div>
    )
  }
  // Pad to 24 hours so the chart always shows the full day.
  const byHour = new Map(hours.map((h) => [h.hour, h]))
  const allHours = Array.from({ length: 24 }, (_, h) => byHour.get(h) || { hour: h, revenue: 0, orders: 0, avg_ticket: 0 })

  const maxRev = Math.max(...allHours.map((h) => Number(h.revenue || 0)), 1)
  const totalRev = allHours.reduce((s, h) => s + Number(h.revenue || 0), 0)
  const totalOrders = allHours.reduce((s, h) => s + (h.orders || 0), 0)
  // Find the peak hour (by revenue) for the inline insight
  const peakHour = allHours.reduce((best, h) => (Number(h.revenue) > Number(best.revenue) ? h : best))
  const peakShare = totalRev ? Number(peakHour.revenue) / totalRev : 0

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 className="section-h2" style={{ marginBottom: 0 }}>By hour — {monthLabel}</h2>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Peak: <b>{String(peakHour.hour).padStart(2, '0')}:00</b> ({PCT(peakShare)} of revenue)
        </span>
      </div>
      <div className="hourly-chart">
        {allHours.map((h) => {
          const pct = (Number(h.revenue) / maxRev) * 100
          const isPeak = h.hour === peakHour.hour
          return (
            <div key={h.hour} className="hourly-col" title={`${String(h.hour).padStart(2,'0')}:00 — ${ILS.format(h.revenue)} / ${h.orders} orders`}>
              <div className="hourly-bar-wrap">
                <div className={`hourly-bar ${isPeak ? 'peak' : ''}`} style={{ height: `${pct}%` }} />
              </div>
              <div className="hourly-label">{String(h.hour).padStart(2, '0')}</div>
            </div>
          )
        })}
      </div>
      <div className="muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
        Hover a bar for details. Total: {ILS.format(totalRev)} across {totalOrders} orders.
      </div>
    </div>
  )
}

function PaymentsCard({ payments, totalNet }) {
  // Sort: known methods in METHOD_ORDER first, then anything else by net desc.
  const known = payments.filter((p) => METHOD_ORDER.includes(p.method))
    .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method))
  const unknown = payments.filter((p) => !METHOD_ORDER.includes(p.method))
    .sort((a, b) => Number(b.net_incl_vat) - Number(a.net_incl_vat))
  const rows = [...known, ...unknown]

  return (
    <div className="card">
      <h2 className="section-h2">Payment methods</h2>
      {/* Stacked bar showing share of net per method */}
      {totalNet > 0 && (
        <div className="payments-bar">
          {rows.map((p) => {
            const share = Number(p.net_incl_vat) / totalNet
            const disp = METHOD_DISPLAY[p.method] || METHOD_DISPLAY.other
            if (share <= 0) return null
            return (
              <div
                key={p.method}
                className="payments-bar-seg"
                style={{ flexBasis: `${share * 100}%`, background: disp.color }}
                title={`${disp.label}: ${ILS.format(p.net_incl_vat)} (${PCT(share)})`}
              />
            )
          })}
        </div>
      )}
      <table className="table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Method</th>
            <th style={{ textAlign: 'right' }}>Orders</th>
            <th style={{ textAlign: 'right' }}>Net</th>
            <th style={{ textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const disp = METHOD_DISPLAY[p.method] || METHOD_DISPLAY.other
            const share = totalNet ? Number(p.net_incl_vat) / totalNet : 0
            return (
              <tr key={p.method}>
                <td>
                  <span className="payments-dot" style={{ background: disp.color }} />
                  {disp.label}
                </td>
                <td className="num">{p.orders}</td>
                <td className="num">{ILS.format(Number(p.net_incl_vat))}</td>
                <td className="num">{PCT(share)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CategoriesCard({ categories }) {
  if (!categories.length) {
    return <div className="card"><h2 className="section-h2">By category</h2><p className="muted">No item data.</p></div>
  }
  const total = categories.reduce((s, c) => s + c.revenue, 0)
  return (
    <div className="card">
      <h2 className="section-h2">By category</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Category</th>
            <th style={{ textAlign: 'right' }}>Units</th>
            <th style={{ textAlign: 'right' }}>Revenue</th>
            <th style={{ textAlign: 'right' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.category}>
              <td>{c.category}</td>
              <td className="num">{c.units}</td>
              <td className="num">{ILS.format(c.revenue)}</td>
              <td className="num">{PCT(c.revenue / total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TopItems({ items }) {
  const maxUnits = Math.max(...items.map((i) => i.units_sold), 1)
  return (
    <table className="table top-items">
      <thead>
        <tr>
          <th>#</th>
          <th>Item</th>
          <th style={{ textAlign: 'right' }}>Units</th>
          <th style={{ textAlign: 'right' }}>Revenue</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i}>
            <td className="muted">{i + 1}</td>
            <td>
              <div className="item-name">{it.item_name}</div>
              <div className="muted item-cat">{it.category || '—'}</div>
            </td>
            <td className="num">
              <div className="bar-cell">
                <div className="bar" style={{ width: `${(it.units_sold / maxUnits) * 100}%` }} />
                <span>{it.units_sold}</span>
              </div>
            </td>
            <td className="num">{ILS.format(it.revenue_incl_vat)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmptyState() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <h2 className="section-h2">No in-store data yet</h2>
        <p className="muted">
          Drop your 3 monthly Nayax CSVs in the form below — hourly, items, and payments.
          The dashboard will populate as soon as the upload succeeds.
        </p>
      </div>
      <UploadCard />
    </div>
  )
}

function SchemaMissingState() {
  return (
    <div className="card">
      <h2 className="section-h2">Database tables not created yet</h2>
      <p>The in-store tables don&apos;t exist in Supabase yet. Run this once to create them:</p>
      <ol className="muted" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
        <li>Open the Supabase dashboard → SQL Editor → New query</li>
        <li>Paste the contents of <code>webapp/supabase-finance-schema.sql</code></li>
        <li>Click <b>Run</b> (the file is idempotent — safe to re-run on top of existing tables)</li>
      </ol>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Then reload this page. Once the tables exist you can backfill May 2026 with
        {' '}<code>node --env-file=.env.local scripts/backfill-nayax.mjs 2026-05</code>.
      </p>
    </div>
  )
}

function ErrorState({ error }) {
  const detail = error?.cause || error
  return (
    <div className="card">
      <h2 className="section-h2" style={{ color: 'var(--danger)' }}>Could not load in-store data</h2>
      <p className="muted">Supabase returned an error. Check the table below and the server logs.</p>
      <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontSize: '0.8rem', overflowX: 'auto' }}>
        {JSON.stringify({ message: detail?.message, code: detail?.code, hint: detail?.hint, details: detail?.details }, null, 2)}
      </pre>
    </div>
  )
}
