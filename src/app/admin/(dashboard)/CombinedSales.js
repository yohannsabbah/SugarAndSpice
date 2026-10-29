import { getCombinedCategoryBreakdown, getCombinedTopItems } from '@/lib/db/finance'
import { prettyCategory } from '@/lib/itemCategories'
import './wolt/wolt.css'
import './overview.css'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const PCT = (v) => `${(v * 100).toFixed(1)}%`


// In-store + Wolt item sales for one month, added together.
// month: 'YYYY-MM'
export default async function CombinedSales({ month, monthLabel }) {
  const [categories, topItems] = await Promise.all([
    getCombinedCategoryBreakdown(`${month}-01`).catch(() => []),
    getCombinedTopItems(`${month}-01`, 25).catch(() => []),
  ])

  return (
    <>
      <div className="card">
        <h2 className="section-h2">Categories — {monthLabel}</h2>
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
          In-store + Wolt. Amounts include VAT.
        </p>
        {categories.length ? <CategoriesTable rows={categories} /> : <p className="muted">No item data for this month.</p>}
      </div>

      <div className="card">
        <h2 className="section-h2">Top items — {monthLabel}</h2>
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
          In-store + Wolt. Amounts include VAT.
        </p>
        {topItems.length ? <TopItemsTable items={topItems} /> : <p className="muted">No item data for this month.</p>}
      </div>
    </>
  )
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
