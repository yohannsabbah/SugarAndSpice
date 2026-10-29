import 'server-only'
import { supabase } from '@/lib/supabase'

// All rows of a table. Supabase returns at most 1000 rows per request, and
// the sales tables grow by about 120 rows each month.
async function selectAll(table, columns) {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

// Every item in the catalog with where it sells, units, revenue and average
// price over all months, for the settings page. Sources come from the monthly
// items CSVs: Nayax (in-store, with the Nayax group) and Wolt.
export async function listItemsWithSales() {
  const [items, nayax, wolt] = await Promise.all([
    selectAll('items', 'id, display_name, merchant_sku, category, created_at'),
    selectAll('nayax_period_items', 'item_id, raw_category, units_sold, revenue_incl_vat'),
    selectAll('wolt_period_items', 'item_id, units_sold, revenue_incl_vat'),
  ])

  const byId = new Map(items.map((it) => [it.id, {
    ...it,
    category: it.category || 'other',
    sources: new Set(),
    nayaxGroups: new Set(),
    units: 0,
    revenue: 0,
  }]))
  for (const r of nayax) {
    const it = byId.get(r.item_id)
    if (!it) continue
    it.sources.add('In-store')
    if (r.raw_category) it.nayaxGroups.add(r.raw_category.trim())
    it.units += Number(r.units_sold || 0)
    it.revenue += Number(r.revenue_incl_vat || 0)
  }
  for (const r of wolt) {
    const it = byId.get(r.item_id)
    if (!it) continue
    it.sources.add('Wolt')
    it.units += Number(r.units_sold || 0)
    it.revenue += Number(r.revenue_incl_vat || 0)
  }
  // "New" = first seen in the last 30 days, so fresh items stand out for a check.
  const newSince = Date.now() - 30 * 24 * 3600 * 1000
  return [...byId.values()].map((it) => ({
    ...it,
    isNew: new Date(it.created_at).getTime() >= newSince,
    sources: [...it.sources],
    nayaxGroups: [...it.nayaxGroups],
    avgPrice: it.units > 0 ? it.revenue / it.units : null,
    revenue: Math.round(it.revenue),
  }))
}

export async function setItemCategory(id, category) {
  const { data, error } = await supabase
    .from('items')
    .update({ category })
    .eq('id', id)
    .select('id, category')
    .maybeSingle()
  if (error) throw error
  return data
}
