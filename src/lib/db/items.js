import 'server-only'
import { supabase } from '@/lib/supabase'

// Every item in the catalog with where it sells and its total revenue, for the
// settings page. Sources come from the monthly items CSVs: Nayax (in-store,
// with the Nayax group) and Wolt.
export async function listItemsWithSales() {
  const [items, nayax, wolt] = await Promise.all([
    supabase.from('items').select('id, display_name, merchant_sku, category, created_at'),
    supabase.from('nayax_period_items').select('item_id, raw_category, revenue_incl_vat'),
    supabase.from('wolt_period_items').select('item_id, revenue_incl_vat'),
  ])
  if (items.error) throw items.error
  if (nayax.error) throw nayax.error
  if (wolt.error) throw wolt.error

  const byId = new Map(items.data.map((it) => [it.id, {
    ...it,
    category: it.category || 'other',
    sources: new Set(),
    nayaxGroups: new Set(),
    revenue: 0,
  }]))
  for (const r of nayax.data) {
    const it = byId.get(r.item_id)
    if (!it) continue
    it.sources.add('In-store')
    if (r.raw_category) it.nayaxGroups.add(r.raw_category.trim())
    it.revenue += Number(r.revenue_incl_vat || 0)
  }
  for (const r of wolt.data) {
    const it = byId.get(r.item_id)
    if (!it) continue
    it.sources.add('Wolt')
    it.revenue += Number(r.revenue_incl_vat || 0)
  }
  // "New" = first seen in the last 30 days, so fresh items stand out for a check.
  const newSince = Date.now() - 30 * 24 * 3600 * 1000
  return [...byId.values()].map((it) => ({
    ...it,
    isNew: new Date(it.created_at).getTime() >= newSince,
    sources: [...it.sources],
    nayaxGroups: [...it.nayaxGroups],
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
