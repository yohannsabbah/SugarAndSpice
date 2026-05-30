import 'server-only'
import { supabase } from '@/lib/supabase'

export async function getOpenShift(employeeId) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function startShift(employeeId) {
  const existing = await getOpenShift(employeeId)
  if (existing) return existing
  const { data, error } = await supabase
    .from('shifts')
    .insert({ employee_id: employeeId, started_at: new Date().toISOString() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function endShift(shiftId) {
  const { data, error } = await supabase
    .from('shifts')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', shiftId)
    .is('ended_at', null)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listShifts({ employeeId, from, to, limit = 200 } = {}) {
  let q = supabase
    .from('shifts')
    .select('*, employees(name)')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (employeeId) q = q.eq('employee_id', employeeId)
  if (from) q = q.gte('started_at', from)
  if (to) q = q.lte('started_at', to)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getShift(id) {
  const { data, error } = await supabase
    .from('shifts')
    .select('*, employees(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateShift(id, patch, { byEmployee = false } = {}) {
  const update = { ...patch }
  if (byEmployee) update.edited_by_employee = true
  else update.edited_by_manager = true
  const { data, error } = await supabase
    .from('shifts')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteShift(id) {
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw error
}

export async function createShift(
  { employee_id, started_at, ended_at, note },
  { byEmployee = false } = {},
) {
  const row = {
    employee_id,
    started_at,
    ended_at: ended_at || null,
    note: note || null,
    edited_by_employee: byEmployee,
    edited_by_manager: !byEmployee,
  }
  const { data, error } = await supabase.from('shifts').insert(row).select().single()
  if (error) throw error
  return data
}
