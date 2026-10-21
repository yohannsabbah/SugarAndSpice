import 'server-only'
import { supabase } from '@/lib/supabase'

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
