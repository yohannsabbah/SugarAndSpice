'use client'

import { useMemo, useState } from 'react'
import { ITEM_CATEGORY_LABEL, prettyCategory } from '@/lib/itemCategories'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const SOURCES = ['All', 'In-store', 'Wolt']

// Every item from Nayax and Wolt with its category. A change saves at once and
// every page (overview, finance, in-store, Wolt) uses it. The automatic rules
// set a category only when an item is first seen, so a change here stays.
export default function ItemCategoriesCard({ items: initialItems }) {
  const [items, setItems] = useState(initialItems)
  const [category, setCategory] = useState('all')
  const [source, setSource] = useState('All')
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState(null)

  const counts = useMemo(() => {
    const c = {}
    for (const it of items) c[it.category] = (c[it.category] || 0) + 1
    return c
  }, [items])

  // "Other" and new items first: they are the ones most likely to need a fix.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((it) => category === 'all' || it.category === category)
      .filter((it) => source === 'All' || it.sources.includes(source))
      .filter((it) => !q || it.display_name.toLowerCase().includes(q) || it.nayaxGroups.some((g) => g.toLowerCase().includes(q)))
      .sort((a, b) =>
        (b.category === 'other') - (a.category === 'other') ||
        b.isNew - a.isNew ||
        b.revenue - a.revenue)
  }, [items, category, source, search])

  async function onChange(item, next) {
    const prev = item.category
    setItems((all) => all.map((it) => (it.id === item.id ? { ...it, category: next } : it)))
    setSavingId(item.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`)
    } catch (e) {
      setItems((all) => all.map((it) => (it.id === item.id ? { ...it, category: prev } : it)))
      setError(`Could not save "${item.display_name}": ${e.message}`)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Item categories</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Each item from Nayax (in-store) and Wolt has one category. Change it here and every page uses the new
        category. New items get a category from their name the first time they are uploaded. Check them here.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>
          All ({items.length})
        </CategoryChip>
        {Object.keys(ITEM_CATEGORY_LABEL).map((c) => (
          <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {prettyCategory(c)} ({counts[c] || 0})
          </CategoryChip>
        ))}
      </div>

      <div className="upload-grid" style={{ marginBottom: 12 }}>
        <label className="upload-field">
          <span>Search</span>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Item name or Nayax group"
          />
        </label>
        <label className="upload-field">
          <span>Sold in</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {error && (
        <div className="insight bad" style={{ marginBottom: 12 }}>
          <div className="insight-body">⚠ {error}</div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Sold in</th>
              <th>Nayax group</th>
              <th style={{ textAlign: 'right' }}>Revenue (all months)</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.id}>
                <td style={{ fontWeight: 600 }}>
                  {it.display_name}
                  {it.isNew && <span className="badge badge-emp" style={{ marginInlineStart: 8 }}>New</span>}
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{it.sources.join(', ') || '—'}</td>
                <td className="muted">{it.nayaxGroups.join(', ') || '—'}</td>
                <td className="num">{ILS.format(it.revenue)}</td>
                <td>
                  <select
                    value={it.category}
                    onChange={(e) => onChange(it, e.target.value)}
                    disabled={savingId === it.id}
                  >
                    {Object.keys(ITEM_CATEGORY_LABEL).map((c) => (
                      <option key={c} value={c}>{prettyCategory(c)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="muted" style={{ marginTop: 12 }}>No items match.</p>}
      </div>
    </div>
  )
}

function CategoryChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`btn ${active ? 'btn-primary' : 'btn-ghost'}`}
      style={{ padding: '6px 12px', fontSize: '0.85rem' }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
