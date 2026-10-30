import 'server-only'
import { supabase } from '@/lib/supabase'
import { receiptMonth, receiptMonthBounds } from '@/lib/receipts/month'

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

// The newest uploads, for the employee screen. Copies (two receipts in one
// photo) have no hash and are left out, so each photo shows once.
export async function listRecentReceipts(limit) {
  const { data, error } = await supabase
    .from('receipts')
    .select('id, s3_key, uploaded_at, employees(name)')
    .not('image_sha256', 'is', null)
    .order('uploaded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
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

// Every counted receipt (no duplicates, with an amount), grouped by month for
// the admin overview: Map 'YYYY-MM' → [{ total, category }].
export async function getReceiptsByMonth() {
  const { data, error } = await supabase
    .from('receipts')
    .select('purchased_at, uploaded_at, total, category')
    .is('duplicate_of', null)
    .not('total', 'is', null)
  if (error) throw error
  const by = new Map()
  for (const r of data) {
    const month = receiptMonth(r)
    if (!by.has(month)) by.set(month, [])
    by.get(month).push({ total: Number(r.total), category: r.category })
  }
  return by
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
    .select('*, employees(name)')
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

// A second row on the photo of `row`, for a photo that shows two receipts.
// It has no image hash (the first row keeps the photo's hash) and starts
// reviewed, so extraction never overwrites it. Receipt number and amount stay
// empty for the owner to fill in, so the month total does not count the
// first receipt twice.
export async function createReceiptCopy(row) {
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      s3_key: row.s3_key,
      file_name: row.file_name,
      image_sha256: null,
      uploaded_at: row.uploaded_at,
      uploaded_by: row.uploaded_by,
      purchased_at: row.purchased_at,
      purchased_time: row.purchased_time,
      vendor: row.vendor,
      category: row.category,
      vat_rate: row.vat_rate,
      parse_status: 'reviewed',
      reviewed_at: new Date().toISOString(),
    })
    .select('*, employees(name)')
    .single()
  if (error) throw error
  return data
}

export async function countReceiptsWithKey(s3Key) {
  const { count, error } = await supabase
    .from('receipts')
    .select('id', { count: 'exact', head: true })
    .eq('s3_key', s3Key)
  if (error) throw error
  return count ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// The owner's names, by business number
// ─────────────────────────────────────────────────────────────────────────────

export async function getReceiptVendor(businessId) {
  const { data, error } = await supabase.from('receipt_vendors').select('vendor, category').eq('business_id', businessId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveReceiptVendor(businessId, { vendor, category }) {
  const { error } = await supabase
    .from('receipt_vendors')
    .upsert({ business_id: businessId, vendor, category, updated_at: new Date().toISOString() })
  if (error) throw error
}

// Removes the row only. The admin route moves the photo to receipts/deleted/ first.
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
