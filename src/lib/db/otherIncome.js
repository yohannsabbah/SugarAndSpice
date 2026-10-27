import 'server-only'
import { supabase } from '@/lib/supabase'

// Income entered by hand (event sales paid by transfer…). See section 20 of
// supabase-finance-schema.sql.

export const PAYMENT_METHODS = ['transfer', 'cheque', 'cash', 'card', 'other']

// 42P01 = postgres undefined_table; PGRST205 = PostgREST schema-cache miss.
function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

// { items, tableMissing } for one 'YYYY-MM', oldest first.
export async function getOtherIncomeForMonth(month) {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const { data, error } = await supabase
    .from('other_income')
    .select('*')
    .gte('received_on', `${month}-01`)
    .lt('received_on', next)
    .order('received_on')
  if (error) {
    if (isMissingTable(error)) return { items: [], tableMissing: true }
    throw error
  }
  return { items: data, tableMissing: false }
}

// Map 'YYYY-MM' → rows, for the overview. Empty until the table exists.
export async function getOtherIncomeByMonth() {
  const { data, error } = await supabase.from('other_income').select('received_on, amount, includes_vat')
  if (error) {
    if (isMissingTable(error)) return new Map()
    throw error
  }
  const by = new Map()
  for (const r of data) {
    const month = r.received_on.slice(0, 7)
    if (!by.has(month)) by.set(month, [])
    by.get(month).push(r)
  }
  return by
}

export async function createOtherIncome(row) {
  const { data, error } = await supabase.from('other_income').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function deleteOtherIncome(id) {
  const { error } = await supabase.from('other_income').delete().eq('id', id)
  if (error) throw error
}
