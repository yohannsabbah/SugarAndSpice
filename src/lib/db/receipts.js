import 'server-only'
import { supabase } from '@/lib/supabase'
import { receiptMonthBounds } from '@/lib/receipts/month'

const UNIQUE_VIOLATION = '23505'

export async function findReceiptByHash(sha256) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id')
    .eq('image_sha256', sha256)
    .maybeSingle()
  if (error) throw error
  return data
}

// Idempotent on the image hash: a second upload of the same photo returns the
// first row unchanged. The unique-violation fallback covers two uploads of one
// photo that race past the duplicate check in the upload-url route.
export async function createReceipt({ s3Key, fileName, sha256, uploadedBy }) {
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      s3_key: s3Key,
      file_name: fileName,
      image_sha256: sha256,
      uploaded_by: uploadedBy,
    })
    .select('id')
    .single()
  if (!error) return { id: data.id, created: true }
  if (error.code !== UNIQUE_VIOLATION) throw error
  const existing = await findReceiptByHash(sha256)
  if (!existing) throw error
  return { id: existing.id, created: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin page and extraction
// ─────────────────────────────────────────────────────────────────────────────

// Effective month: the printed date when the model or the owner set one, else
// the Israel upload date. See src/lib/receipts/month.js.
export async function listReceiptsForMonth(month) {
  const b = receiptMonthBounds(month)
  const { data, error } = await supabase
    .from('receipts')
    .select('*, employees(name)')
    .or(
      `and(purchased_at.gte.${b.dateFrom},purchased_at.lt.${b.dateTo}),` +
        `and(purchased_at.is.null,uploaded_at.gte.${b.uploadedFrom},uploaded_at.lt.${b.uploadedTo})`,
    )
    .order('purchased_at', { ascending: true, nullsFirst: false })
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data
}

export async function getReceipt(id) {
  const { data, error } = await supabase.from('receipts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function updateReceipt(id, fields) {
  const { data, error } = await supabase
    .from('receipts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Writes only while the row still has one of `statuses`. Returns the row, or
// null when it changed meanwhile (for example, the owner reviewed it).
export async function updateReceiptIfStatus(id, statuses, fields) {
  const { data, error } = await supabase
    .from('receipts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('parse_status', statuses)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data
}

// The S3 object stays: a mistaken delete stays recoverable.
export async function deleteReceipt(id) {
  const { error } = await supabase.from('receipts').delete().eq('id', id)
  if (error) throw error
}

export async function listPendingReceipts(limit) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id')
    .eq('parse_status', 'pending')
    .order('uploaded_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return data
}

export async function countPendingReceipts() {
  const { count, error } = await supabase
    .from('receipts')
    .select('id', { count: 'exact', head: true })
    .eq('parse_status', 'pending')
  if (error) throw error
  return count ?? 0
}

export async function listDuplicateCandidates({ purchasedAt, total, excludeId }) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id, purchased_at, purchased_time, receipt_number, total, uploaded_at, duplicate_of, parse_status')
    .eq('purchased_at', purchasedAt)
    .eq('total', total)
    .neq('id', excludeId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data
}
