import 'server-only'
import { supabase } from '@/lib/supabase'

// Fixed monthly expenses (rent, subscriptions). See section 19 of
// supabase-finance-schema.sql.

export const PAYMENT_METHODS = ['cheque', 'transfer', 'standing_order', 'card', 'cash', 'other']

// 42P01 = postgres undefined_table; PGRST205 = PostgREST schema-cache miss.
// Both mean the table is not created yet, so callers see an empty list.
function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

// { items, tableMissing } — tableMissing is true until the SQL in section 19
// of supabase-finance-schema.sql has been run.
export async function getRecurringExpenses() {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .order('start_month', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return { items: [], tableMissing: true }
    throw error
  }
  return { items: data, tableMissing: false }
}

export async function listRecurringExpenses() {
  return (await getRecurringExpenses()).items
}

export async function createRecurringExpense(row) {
  const { data, error } = await supabase.from('recurring_expenses').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateRecurringExpense(id, fields) {
  const { data, error } = await supabase.from('recurring_expenses').update(fields).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteRecurringExpense(id) {
  const { error } = await supabase.from('recurring_expenses').delete().eq('id', id)
  if (error) throw error
}

// Every 'YYYY-MM' a recurring expense covers, up to `lastMonth` ('YYYY-MM').
export function monthsCovered(item, lastMonth) {
  const end = item.end_month ? item.end_month.slice(0, 7) : lastMonth
  const stop = end < lastMonth ? end : lastMonth
  const months = []
  let [y, m] = item.start_month.slice(0, 7).split('-').map(Number)
  for (let key = item.start_month.slice(0, 7); key <= stop; ) {
    months.push(key)
    m += 1
    if (m > 12) { m = 1; y += 1 }
    key = `${y}-${String(m).padStart(2, '0')}`
  }
  return months
}
