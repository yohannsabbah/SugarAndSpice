import { getCategoryTrend, getCombinedCategoryBreakdown, getCombinedTopItems, getTopItemsTrend } from '@/lib/db/finance'
import { prettyCategory } from '@/lib/itemCategories'
import { FIRST_MONTH, DEFAULT_MONTHS, monthsBetween, resolveMonthRange } from '@/lib/monthRange'
import MonthRangePicker from '@/components/MonthRangePicker'
import ViewToggle from '@/components/ViewToggle'
import TrendChart from '@/components/TrendChart'
import { SERIES_COLORS } from '@/components/chartScale'
import './wolt/wolt.css'
import './overview.css'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`

// Lines in the Top items chart. Past SERIES_COLORS.length, the colors repeat
// as dashed lines (see seriesStyle).
const TOP_ITEMS_IN_CHART = 15

// In-store + Wolt item sales, added together. Each card has a Table view (one
// month) and a Chart view (revenue per month over a range). The cards keep
// their own params, so they do not change the Month by month card:
// cat_view / cat_from / cat_to and items_view / items_from / items_to.
// month: 'YYYY-MM'
export default async function CombinedSales({ month, monthLabel, searchParams }) {
  const catView = searchParams.cat_view === 'chart' ? 'chart' : 'table'
  const itemsView = searchParams.items_view === 'chart' ? 'chart' : 'table'
  const catRange = resolveMonthRange(searchParams.cat_from, searchParams.cat_to)
  const itemsRange = resolveMonthRange(searchParams.items_from, searchParams.items_to)

  const [categories, topItems, catTrend, itemsTrend] = await Promise.all([
    catView === 'table' ? getCombinedCategoryBreakdown(`${month}-01`).catch(() => []) : null,
    itemsView === 'table' ? getCombinedTopItems(`${month}-01`, 25).catch(() => []) : null,
    catView === 'chart' ? getCategoryTrend(catRange.from, catRange.to).catch(() => null) : null,
    itemsView === 'chart' ? getTopItemsTrend(itemsRange.from, itemsRange.to, TOP_ITEMS_IN_CHART).catch(() => null) : null,
  ])

  return (
    <>
      <div className="card">
        <SalesCardHeader
          title={catView === 'chart' ? 'Categories by month' : `Categories — ${monthLabel}`}
          view={catView}
          prefix="cat"
          range={catRange}
          searchParams={searchParams}
        />
        {catView === 'chart' ? (
          <SalesTrend
            trend={catTrend}
            range={catRange}
            labelOf={(s) => prettyCategory(s.key)}
            ariaLabel="Revenue per month for each category, incl. VAT"
          />
        ) : categories.length ? (
          <CategoriesTable rows={categories} />
        ) : (
          <p className="muted">No item data for this month.</p>
        )}
      </div>

      <div className="card">
        <SalesCardHeader
          title={itemsView === 'chart' ? `Top ${TOP_ITEMS_IN_CHART} items by month` : `Top items — ${monthLabel}`}
          view={itemsView}
          prefix="items"
          range={itemsRange}
          searchParams={searchParams}
        />
        {itemsView === 'chart' ? (
          <SalesTrend
            trend={itemsTrend}
            range={itemsRange}
            labelOf={(s) => s.label}
            ariaLabel={`Revenue per month for the top ${TOP_ITEMS_IN_CHART} items, incl. VAT`}
          />
        ) : topItems.length ? (
          <TopItemsTable items={topItems} />
        ) : (
          <p className="muted">No item data for this month.</p>
        )}
      </div>
    </>
  )
}

function SalesCardHeader({ title, view, prefix, range, searchParams }) {
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-h2" style={{ margin: 0 }}>{title}</h2>
        {view === 'chart' && (
          <MonthRangePicker
            from={range.from}
            to={range.to}
            defaultFrom={range.defaultFrom}
            min={FIRST_MONTH}
            max={range.currentMonth}
            defaultLabel={`Last ${DEFAULT_MONTHS} months`}
            fromParam={`${prefix}_from`}
            toParam={`${prefix}_to`}
          />
        )}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          {view === 'chart'
            ? 'In-store + Wolt revenue, incl. VAT. Hover a month for the numbers.'
            : 'In-store + Wolt. Amounts include VAT.'}
        </p>
        <ViewToggle view={view} searchParams={searchParams} param={`${prefix}_view`} />
      </div>
    </>
  )
}

// The first SERIES_COLORS.length series are solid. The next ones take the same
// colors in the same order, dashed, so no two lines share both color and style.
function seriesStyle(i) {
  return { color: SERIES_COLORS[i % SERIES_COLORS.length], dashed: i >= SERIES_COLORS.length }
}

// trend: { months, series } from getCategoryTrend / getTopItemsTrend, or null
// when the query failed. Every month of the range gets a slot. A month with no
// item data shows a gap in every line.
function SalesTrend({ trend, range, labelOf, ariaLabel }) {
  if (!trend) return <p className="muted">Could not load item data.</p>
  if (!trend.series.length) return <p className="muted">No item data for this range.</p>
  const withData = new Set(trend.months)
  const months = monthsBetween(range.from, range.to).map((m) => ({
    month: m,
    label: new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    inProgress: m === range.currentMonth,
    hasData: withData.has(m),
  }))
  const series = trend.series.map((s, i) => ({
    key: s.key,
    label: labelOf(s),
    ...seriesStyle(i),
    values: months.map((m) => (m.hasData ? s.byMonth[m.month] || 0 : null)),
  }))
  return <TrendChart months={months} series={series} ariaLabel={ariaLabel} />
}

function CategoriesTable({ rows }) {
  const grand = rows.reduce((s, r) => s + r.total_revenue, 0)
  const maxTotal = Math.max(...rows.map((r) => r.total_revenue), 1)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Category</th>
            <th style={{ textAlign: 'right' }}>In-store</th>
            <th style={{ textAlign: 'right' }}>Wolt</th>
            <th style={{ textAlign: 'right' }}>Total</th>
            <th style={{ textAlign: 'right' }}>Share</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = grand ? r.total_revenue / grand : 0
            const barWidth = (r.total_revenue / maxTotal) * 100
            return (
              <tr key={r.category}>
                <td style={{ fontWeight: 600 }}>{prettyCategory(r.category)}</td>
                <td className="num">
                  {r.instore_revenue > 0 ? (
                    <>{ILS.format(r.instore_revenue)} <span className="muted">/ {r.instore_units}u</span></>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="num">
                  {r.wolt_revenue > 0 ? (
                    <>{ILS.format(r.wolt_revenue)} <span className="muted">/ {r.wolt_units}u</span></>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>{ILS.format(r.total_revenue)}</td>
                <td className="num">{PCT(share)}</td>
                <td className="overview-bar-cell">
                  <div className="overview-bar" style={{ width: `${barWidth}%` }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TopItemsTable({ items }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table top-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>In-store</th>
            <th style={{ textAlign: 'right' }}>Wolt</th>
            <th style={{ textAlign: 'right' }}>Total units</th>
            <th style={{ textAlign: 'right' }}>Total revenue</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td>
                <div className="item-name">{it.item_name}</div>
                <div className="muted item-cat">{prettyCategory(it.category || 'other')}</div>
              </td>
              <td className="num">{it.instore_units > 0 ? it.instore_units : <span className="muted">—</span>}</td>
              <td className="num">{it.wolt_units > 0 ? it.wolt_units : <span className="muted">—</span>}</td>
              <td className="num" style={{ fontWeight: 600 }}>{it.total_units}</td>
              <td className="num">{ILS.format(it.total_revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
