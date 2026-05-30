import 'server-only'
import { supabase } from '@/lib/supabase'

export async function listEmployees({ includeInactive = false } = {}) {
  let q = supabase.from('employees').select('*').order('name')
  if (!includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getEmployee(id) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function addEmployee(name) {
  const clean = (name || '').trim()
  if (!clean) throw new Error('Name is required')
  const { data, error } = await supabase
    .from('employees')
    .insert({ name: clean })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEmployee(id, patch) {
  const { data, error } = await supabase
    .from('employees')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw error
}
