import {
  getWoltPeriodSummaries,
  getTopItemsByMonth,
  getCategorySalesByMonth,
  getLastIpadDeduction,
  getRecentLowReviews,
  getReviewBreakdownByMonth,
} from '@/lib/db/wolt'
import './wolt.css'

export const dynamic = 'force-dynamic'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const ILSp = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`

function fmtDateRange(start, end) {
  return `${start.slice(8, 10)}–${end.slice(8, 10)} ${new Date(start).toLocaleString('en-IL', { month: 'short' })}`
}

function emptyMonth(monthKey) {
  return {
    month: monthKey, label: monthLabelOf(monthKey),
    gross: 0, netSales: 0, refunds: 0,
    fees: 0, commission: 0, ads: 0, perOrderWp: 0, feesOther: 0,
    withholding: 0, installments: 0, net: 0,
    orders: 0, ordersTotal: 0, ordersPickup: 0, ordersDelivery: 0, ordersRejected: 0,
    aov: 0, woltPlusOrders: 0, lowReviews: 0,
  }
}

function monthLabelOf(monthKey) {
  // 'YYYY-MM' → 'May 2026'
  return new Date(`${monthKey}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
}

function rollupByMonth(allPeriods) {
  // Roll all Wolt billing cycles into calendar months. The half-month structure
  // is an implementation detail of how Wolt invoices us — the dashboard surfaces
  // only month totals.
  const byMonth = new Map()
  for (const p of allPeriods) {
    const monthKey = p.period_start.slice(0, 7)
    const m = byMonth.get(monthKey) || emptyMonth(monthKey)
    m.gross         += Number(p.gross_sales_incl_vat || 0)
    m.netSales      += Number(p.net_sales_incl_vat   || p.gross_sales_incl_vat || 0)
    m.refunds       += Number(p.refunds_incl_vat     || 0)
    m.fees          += Number(p.wolt_fees_incl_vat   || 0)
    m.commission    += Number(p.fees_commissions     || 0)
    m.ads           += Number(p.fees_ads             || 0)
    m.perOrderWp    += Number(p.fees_per_order_wp    || 0)
    m.feesOther     += Number(p.fees_other           || 0)
    m.withholding   += Number(p.withholding_amount   || 0)
    m.installments  += Number(p.installments_amount  || 0)
    m.net           += Number(p.net_payout           || 0)
    m.orders         += p.orders_delivered
    m.ordersTotal    += p.orders_total
    m.ordersPickup   += p.orders_pickup
    m.ordersDelivery += p.orders_delivery
    m.ordersRejected += p.orders_rejected
    m.woltPlusOrders += p.wolt_plus_orders || 0
    m.lowReviews     += p.low_reviews || 0
    m._revenue = (m._revenue || 0) + (p.aov || 0) * p.orders_delivered
    byMonth.set(monthKey, m)
  }
  return [...byMonth.values()]
    .map((m) => ({ ...m, aov: m.orders > 0 ? m._revenue / m.orders : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

function monthBoundsISO(monthKey) {
  // 'YYYY-MM' → { startISO, endExclusiveISO } in UTC, day boundaries
  const [y, m] = monthKey.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { startISO: start.toISOString(), endExclusiveISO: end.toISOString() }
}

export default async function WoltInsightsPage({ searchParams }) {
  const sp = await searchParams
  const monthParam = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null

  const [allPeriods, ipad, lowReviews] = await Promise.all([
    getWoltPeriodSummaries(),
    getLastIpadDeduction(),
    getRecentLowReviews(),
  ])

  if (allPeriods.length === 0) {
    return <EmptyState />
  }

  // Default: if no month param, scope to the latest month present in data.
  const latestPeriodAll = allPeriods[allPeriods.length - 1]
  const selectedMonth = monthParam || latestPeriodAll.period_start.slice(0, 7) // "YYYY-MM"
  const monthStart = `${selectedMonth}-01`
  const monthLabel = new Date(`${selectedMonth}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })

  // Filter periods to those starting in the selected month
  const periods = allPeriods.filter((p) => p.period_start.slice(0, 7) === selectedMonth)
  // Previous month, for delta comparisons
  const prevMonth = (() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const prevMonthStart = `${prevMonth}-01`
  const prevPeriods = allPeriods.filter((p) => p.period_start.slice(0, 7) === prevMonth)
  const prevMonthLabel = new Date(`${prevMonth}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })

  const { startISO: curStartISO, endExclusiveISO: curEndISO } = monthBoundsISO(selectedMonth)
  const { startISO: prvStartISO, endExclusiveISO: prvEndISO } = monthBoundsISO(prevMonth)

  const [topItems, categoryItems, curReviews, prvReviews] = await Promise.all([
    getTopItemsByMonth(monthStart, 10),
    getCategorySalesByMonth(monthStart),
    getReviewBreakdownByMonth(curStartISO, curEndISO),
    getReviewBreakdownByMonth(prvStartISO, prvEndISO),
  ])

  // Headline period = latest period in the selected month; previous period for KPIs
  // = either the previous period within month, or last period of previous month.
  const latest = periods.length ? periods[periods.length - 1] : null
  const prevWithinMonth = periods.length >= 2 ? periods[periods.length - 2] : null
  const prevForKPI = prevWithinMonth || (prevPeriods.length ? prevPeriods[prevPeriods.length - 1] : null)
  const prev = prevForKPI

  if (!latest) {
    return (
      <div className="card">
        <h2 className="section-h2">No Wolt data for {monthLabel}</h2>
        <p className="muted">Try selecting a different month above, or upload this month&apos;s Wolt packet.</p>
      </div>
    )
  }

  // ── Month-level aggregates ─────────────────────────────────────────────
  // Roll every Wolt billing cycle (half-month invoice) up to its calendar month.
  // The owner does NOT want half-month numbers visible — always aggregate to month.
  const months = rollupByMonth(allPeriods)
  const monthByKey = new Map(months.map((m) => [m.month, m]))
  const cur = monthByKey.get(selectedMonth) || emptyMonth(selectedMonth)
  const prv = monthByKey.get(prevMonth) || emptyMonth(prevMonth)

  const deltaPct = (a, b) => (!b || b === 0 ? null : (a - b) / b)
  const dGross  = deltaPct(cur.gross,  prv.gross)
  const dNet    = deltaPct(cur.net,    prv.net)
  const dOrders = deltaPct(cur.orders, prv.orders)
  const dAOV    = deltaPct(cur.aov,    prv.aov)
  const dReviewCount = deltaPct(curReviews.total, prvReviews.total)
  const dReviewAvg = deltaPct(curReviews.avg, prvReviews.avg)

  const totalMonths = months.length

  // Other monthly figures used by insight cards (replaces the per-period ones)
  const effectiveTake = cur.gross > 0 ? cur.fees / cur.gross : 0
  const takeWithoutAds = cur.gross > 0 ? (cur.fees - cur.ads) / cur.gross : 0
  const adsShare = cur.gross > 0 ? cur.ads / cur.gross : 0
  const pickupShare = cur.ordersTotal > 0 ? cur.ordersPickup / cur.ordersTotal : 0
  const woltPlusShare = cur.ordersTotal > 0 ? cur.woltPlusOrders / cur.ordersTotal : 0

  const ipadDone = ipad && Number(ipad.remaining_after_payment) <= 0

  // Backward-compat aliases used further down (monthly comparison table reuses)
  const curNet = cur.net, prvNet = prv.net
  const curOrders = cur.orders, prvOrders = prv.orders
  const curAds = cur.ads, prvAds = prv.ads
  const curAOV = cur.aov, prvAOV = prv.aov

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Wolt — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {totalMonths} month{totalMonths > 1 ? 's' : ''} of data loaded
        </span>
      </div>

      {/* ── Executive summary: 4 boxes ─────────────────────────────── */}
      <div className="kpi-row">
        <KPI
          label="Total sales"
          value={ILS.format(cur.gross)}
          delta={dGross}
          deltaSuffix={`vs ${prevMonthLabel}`}
        />
        <KPI
          label="Net to bank"
          value={ILS.format(cur.net)}
          subtitle={cur.gross > 0 ? `${PCT(cur.net / cur.gross)} of total sales` : null}
          delta={dNet}
          deltaSuffix={`vs ${prevMonthLabel}`}
          tone={cur.net > prv.net ? 'ok' : null}
        />
        <KpiDual
          label="Orders / Avg order"
          primary={cur.orders}
          secondary={ILSp.format(cur.aov)}
          deltaPrimary={dOrders}
          deltaSecondary={dAOV}
        />
        <KpiReviews data={curReviews} deltaCount={dReviewCount} deltaAvg={dReviewAvg} />
      </div>

      {/* ── Where your money went (gross → net waterfall) ──────────── */}
      <MoneyWaterfall cur={cur} monthLabel={monthLabel} />

      {/* ── Insight cards ──────────────────────────────────────────── */}
      <div className="insights-grid">
        {ipadDone ? (
          <InsightCard tone="ok" emoji="🎉" title="iPad lease is paid off">
            The final installment was the last one. Starting next month you keep an extra
            <b> {ILS.format(ipad.installment_amount * 2)}/month</b> that used to go to the lease.
          </InsightCard>
        ) : ipad ? (
          <InsightCard tone="info" emoji="📅" title="iPad lease in progress">
            Still owed: {ILS.format(ipad.remaining_after_payment)} (~
            {Math.ceil(ipad.remaining_after_payment / ipad.installment_amount / 2)} more month{Math.ceil(ipad.remaining_after_payment / ipad.installment_amount / 2) > 1 ? 's' : ''}).
          </InsightCard>
        ) : null}

        <InsightCard tone="warn" emoji="📣" title={`Ad spend was ${PCT(adsShare)} of gross this month`}>
          Wolt commission alone is ~25%, but ads pushed your effective take to <b>{PCT(effectiveTake)}</b>.
          Without ads it would be roughly <b>{PCT(takeWithoutAds)}</b>.
          {' '}Without an ad-pause test, ROI is still unverified.
        </InsightCard>

        <InsightCard tone="warn" emoji="📦" title={`Pickup is only ${PCT(pickupShare)} of orders this month`}>
          Pickup commission is 10% vs 25% delivery — every shifted order saves you 15%. Push pickup for low-ticket
          coffees especially.
        </InsightCard>

        <InsightCard tone="info" emoji="⭐" title={`${cur.woltPlusOrders} Wolt+ orders this month`}>
          Wolt+ subscribers are {PCT(woltPlusShare)} of your orders.
          Each Wolt+ order costs you an extra 3.80 ILS flat fee.
        </InsightCard>

        {topItems[0] && (
          <InsightCard tone="ok" emoji="👑" title={`"${topItems[0].item_name}" is your top SKU in ${monthLabel}`}>
            {topItems[0].units_sold} units (revenue {ILS.format(topItems[0].revenue_incl_vat)}). Top sellers
            are heavily bakery — on Wolt this is a dessert business, not a coffee business.
          </InsightCard>
        )}

        {cur.lowReviews > 0 && (
          <InsightCard tone="bad" emoji="🚨" title={`${cur.lowReviews} low review${cur.lowReviews > 1 ? 's' : ''} this month`}>
            Customers left {cur.lowReviews} review(s) at ≤2 stars. Quality complaints on your top SKUs are
            the most expensive — see below.
          </InsightCard>
        )}
      </div>

      {/* ── Month-vs-prev-month rollup ────────────────────────────── */}
      <div className="card">
        <h2 className="section-h2">{monthLabel} vs {prevMonthLabel}</h2>
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th style={{ textAlign: 'right' }}>{prevMonthLabel}</th>
              <th style={{ textAlign: 'right' }}>{monthLabel}</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Net to bank" apr={ILS.format(prvNet)} may={ILS.format(curNet)} delta={deltaPct(curNet, prvNet)} />
            <Row label="Delivered orders" apr={prvOrders} may={curOrders} delta={deltaPct(curOrders, prvOrders)} />
            <Row label="Ad spend" apr={ILS.format(prvAds)} may={ILS.format(curAds)} delta={deltaPct(curAds, prvAds)} />
            <Row label="Avg. order value" apr={ILSp.format(prvAOV)} may={ILSp.format(curAOV)} delta={deltaPct(curAOV, prvAOV)} />
          </tbody>
        </table>
        {prevPeriods.length === 0 && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
            No data for {prevMonthLabel} — comparisons show 0.
          </p>
        )}
      </div>

      {/* ── Monthly history (all months in DB) ─────────────────────── */}
      <div className="card">
        <h2 className="section-h2">Monthly history</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: 'right' }}>Total sales</th>
              <th style={{ textAlign: 'right' }}>Wolt fees</th>
              <th style={{ textAlign: 'right' }}>Take %</th>
              <th style={{ textAlign: 'right' }}>Ads</th>
              <th style={{ textAlign: 'right' }}>Ads %</th>
              <th style={{ textAlign: 'right' }}>Orders</th>
              <th style={{ textAlign: 'right' }}>AOV</th>
              <th style={{ textAlign: 'right' }}>Net to bank</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => {
              const take = m.gross > 0 ? m.fees / m.gross : 0
              const adsPct = m.gross > 0 ? m.ads / m.gross : 0
              const isCurrent = m.month === selectedMonth
              return (
                <tr key={m.month} style={isCurrent ? { background: 'var(--brand-pink-bg)' } : null}>
                  <td style={{ fontWeight: isCurrent ? 700 : 500 }}>{m.label}</td>
                  <td className="num">{ILS.format(m.gross)}</td>
                  <td className="num">{ILS.format(m.fees)}</td>
                  <td className="num"><span className={take > 0.43 ? 'warn-text' : ''}>{PCT(take)}</span></td>
                  <td className="num">{ILS.format(m.ads)}</td>
                  <td className="num">{PCT(adsPct)}</td>
                  <td className="num">
                    {m.orders}
                    {m.ordersRejected ? <span className="muted"> +{m.ordersRejected}r</span> : null}
                  </td>
                  <td className="num">{ILSp.format(m.aov)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{ILS.format(m.net)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Top items + categories for the selected month ─────────── */}
      <div className="grid-2">
        <div className="card">
          <h2 className="section-h2">Top items — {monthLabel}</h2>
          {topItems.length ? <TopItems items={topItems} /> : <p className="muted">No item data for {monthLabel}.</p>}
        </div>
        <div className="card">
          <h2 className="section-h2">By category — {monthLabel}</h2>
          <table className="table">
            <thead>
              <tr><th>Category</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th></tr>
            </thead>
            <tbody>
              {categoryItems.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="num">{c.units}</td>
                  <td className="num">{ILS.format(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Recent low reviews ────────────────────────────────────── */}
      {lowReviews.length > 0 && (
        <div className="card">
          <h2 className="section-h2">Recent low reviews (≤3 stars)</h2>
          <table className="table">
            <thead>
              <tr><th>Order</th><th>When</th><th style={{ textAlign: 'right' }}>Score</th><th>Comment</th><th>Tags</th></tr>
            </thead>
            <tbody>
              {lowReviews.map((r) => (
                <tr key={r.order_no_public + r.placed_at}>
                  <td>{r.order_no_public}</td>
                  <td>{new Date(r.placed_at).toLocaleDateString('en-IL')}</td>
                  <td className="num"><span className={r.review_score <= 2 ? 'warn-text' : ''}>{r.review_score}★</span></td>
                  <td>{r.review_comment || <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: '0.8rem' }}>{r.review_attributions?.join(', ') || ''}</td>
                </tr>
              ))}
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

function KpiDual({ label, primary, secondary, deltaPrimary, deltaSecondary }) {
  return (
    <div className="card kpi kpi-dual">
      <div className="kpi-label">{label}</div>
      <div className="kpi-dual-row">
        <div className="kpi-dual-cell">
          <div className="kpi-value" style={{ fontSize: '1.4rem' }}>{primary}</div>
          {deltaPrimary != null && (
            <div className={`kpi-delta ${deltaPrimary >= 0 ? 'up' : 'down'}`}>
              {deltaPrimary >= 0 ? '↑' : '↓'} {Math.abs(deltaPrimary * 100).toFixed(0)}%
            </div>
          )}
        </div>
        <div className="kpi-dual-cell">
          <div className="kpi-value" style={{ fontSize: '1.4rem' }}>{secondary}</div>
          {deltaSecondary != null && (
            <div className={`kpi-delta ${deltaSecondary >= 0 ? 'up' : 'down'}`}>
              {deltaSecondary >= 0 ? '↑' : '↓'} {Math.abs(deltaSecondary * 100).toFixed(0)}%
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiReviews({ data, deltaCount, deltaAvg }) {
  const { total, avg, distribution } = data
  if (!total) {
    return (
      <div className="card kpi">
        <div className="kpi-label">Customer reviews</div>
        <div className="kpi-value">—</div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>No reviews this month</div>
      </div>
    )
  }
  // Tone: green if avg ≥ 4.5, warn if 4–4.5, bad if < 4
  const tone = avg >= 4.5 ? 'ok' : avg >= 4 ? '' : 'warn'
  return (
    <div className={`card kpi ${tone}`}>
      <div className="kpi-label">Customer reviews</div>
      <div className="kpi-value" style={{ fontSize: '1.4rem' }}>
        ★ {avg.toFixed(2)}
        <span className="muted" style={{ fontSize: '0.9rem', marginLeft: 8, fontWeight: 500 }}>
          / {total} review{total > 1 ? 's' : ''}
        </span>
      </div>
      <div className="review-bars">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = distribution[star] || 0
          const pct = total ? (count / total) * 100 : 0
          return (
            <div key={star} className="review-bar-row" title={`${count} review${count !== 1 ? 's' : ''} at ${star}★`}>
              <span className="review-star-label">{star}★</span>
              <div className="review-bar-track">
                <div
                  className={`review-bar-fill star-${star}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="review-bar-count">{count}</span>
            </div>
          )
        })}
      </div>
      {deltaCount != null && (
        <div className={`kpi-delta ${deltaCount >= 0 ? 'up' : 'down'}`} style={{ marginTop: 6 }}>
          {deltaCount >= 0 ? '↑' : '↓'} {Math.abs(deltaCount * 100).toFixed(0)}% vs prev
        </div>
      )}
    </div>
  )
}

function MoneyWaterfall({ cur, monthLabel }) {
  // The deductions from gross to net-to-bank, with each Wolt fee category broken out.
  // Numbers are stored signed: refunds_incl_vat can be negative (means corrections
  // ADDED to sales). We show absolute values with the right sign in the label.
  const refunds = cur.refunds
  const netSales = cur.netSales
  const fees = cur.fees
  const commission = cur.commission
  const ads = cur.ads
  const perOrderWp = cur.perOrderWp
  const feesOther = cur.feesOther
  const withholding = cur.withholding
  const installments = cur.installments
  const net = cur.net
  const gross = cur.gross

  const pct = (n) => (gross > 0 ? `${(n / gross * 100).toFixed(1)}%` : '—')

  return (
    <div className="card waterfall-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 className="section-h2" style={{ marginBottom: 0 }}>Where your money went — {monthLabel}</h2>
        <span className="muted" style={{ fontSize: '0.8rem' }}>% of total sales</span>
      </div>

      <div className="waterfall">
        {/* Gross — the starting line */}
        <div className="wf-row wf-total">
          <span className="wf-label">Total sales (incl VAT)</span>
          <span className="wf-amount">{ILS.format(gross)}</span>
          <span className="wf-pct">100%</span>
        </div>

        {/* Refunds — can be negative (correction added to sales) */}
        {Math.abs(refunds) > 0.01 && (
          <div className="wf-row wf-deduct">
            <span className="wf-label">{refunds > 0 ? 'Customer refunds / corrections' : 'Corrections added to sales'}</span>
            <span className="wf-amount">{refunds > 0 ? '−' : '+'}{ILS.format(Math.abs(refunds))}</span>
            <span className="wf-pct">{pct(Math.abs(refunds))}</span>
          </div>
        )}
        <div className="wf-row wf-subtotal">
          <span className="wf-label">Net sales</span>
          <span className="wf-amount">{ILS.format(netSales)}</span>
          <span className="wf-pct">{pct(netSales)}</span>
        </div>

        {/* Wolt fees breakdown */}
        <div className="wf-section-h">Wolt kept ({pct(fees)} of total sales)</div>

        <div className="wf-row wf-deduct wf-indent">
          <span className="wf-label">Commission <span className="muted">(25% delivery, 10% pickup)</span></span>
          <span className="wf-amount">−{ILS.format(commission)}</span>
          <span className="wf-pct">{pct(commission)}</span>
        </div>
        {ads > 0.01 && (
          <div className="wf-row wf-deduct wf-indent">
            <span className="wf-label">Ad campaigns <span className="muted">(your spend)</span></span>
            <span className="wf-amount">−{ILS.format(ads)}</span>
            <span className="wf-pct">{pct(ads)}</span>
          </div>
        )}
        {perOrderWp > 0.01 && (
          <div className="wf-row wf-deduct wf-indent">
            <span className="wf-label">Wolt+ per-order fee <span className="muted">(3.80₪ × {cur.woltPlusOrders})</span></span>
            <span className="wf-amount">−{ILS.format(perOrderWp)}</span>
            <span className="wf-pct">{pct(perOrderWp)}</span>
          </div>
        )}
        {feesOther > 0.01 && (
          <div className="wf-row wf-deduct wf-indent">
            <span className="wf-label">Adjustments & missing-item rebates</span>
            <span className="wf-amount">−{ILS.format(feesOther)}</span>
            <span className="wf-pct">{pct(feesOther)}</span>
          </div>
        )}

        {/* Withholding tax + installments */}
        <div className="wf-section-h">Other deductions</div>

        {withholding > 0.01 && (
          <div className="wf-row wf-deduct">
            <span className="wf-label">
              Income-tax advance (5%) <span className="muted">— recoverable when accountant files</span>
            </span>
            <span className="wf-amount">−{ILS.format(withholding)}</span>
            <span className="wf-pct">{pct(withholding)}</span>
          </div>
        )}
        {installments > 0.01 && (
          <div className="wf-row wf-deduct">
            <span className="wf-label">Equipment lease (iPad)</span>
            <span className="wf-amount">−{ILS.format(installments)}</span>
            <span className="wf-pct">{pct(installments)}</span>
          </div>
        )}

        <div className="wf-row wf-total wf-final">
          <span className="wf-label">Net to your bank</span>
          <span className="wf-amount">{ILS.format(net)}</span>
          <span className="wf-pct">{pct(net)}</span>
        </div>
      </div>

      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 10 }}>
        Note: the 5% income-tax advance is <b>not a real cost</b> — your accountant deducts it when you file.
        VAT collected from customers is included in the sale amount and remitted separately.
      </p>
    </div>
  )
}

function InsightCard({ tone, emoji, title, children }) {
  return (
    <div className={`insight ${tone || ''}`}>
      <div className="insight-title">
        <span className="insight-emoji">{emoji}</span> {title}
      </div>
      <div className="insight-body">{children}</div>
    </div>
  )
}

function Row({ label, apr, may, delta }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{apr}</td>
      <td className="num" style={{ fontWeight: 600 }}>{may}</td>
      <td className="num">
        {delta != null && (
          <span className={delta >= 0 ? 'up-text' : 'down-text'}>
            {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
          </span>
        )}
      </td>
    </tr>
  )
}

function TopItems({ items }) {
  const max = Math.max(...items.map((i) => i.units_sold))
  return (
    <table className="table top-items">
      <thead>
        <tr><th>#</th><th>Item</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th></tr>
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
                <div className="bar" style={{ width: `${(it.units_sold / max) * 100}%` }} />
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
    <div className="card">
      <h2 className="section-h2">No Wolt data yet</h2>
      <p className="muted">Run the backfill script (<code>scripts/backfill-wolt.mjs</code>) or upload a period.</p>
    </div>
  )
}
