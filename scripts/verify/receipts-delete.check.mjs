// DELETE /api/admin/receipts/[id] moves the photo to receipts/deleted/ and
// removes the row. Runs on a running dev server with one throwaway object and
// row, both created and cleaned up here.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-delete.check.mjs [baseUrl]
import { createHash } from 'node:crypto'
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { s3Bucket, s3Client } from '@/lib/s3'
import { supabase } from '@/lib/supabase'
import { getReceipt } from '@/lib/db/receipts'

const BASE = process.argv[2] || 'http://localhost:3000'
const COOKIE = `ss_admin=${createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')}`
const client = s3Client()
const Bucket = s3Bucket()
const key = `receipts/00_0000/verify-delete-${Date.now()}.jpg`
const archived = key.replace(/^receipts\//, 'receipts/deleted/')
const H = 'd1'.repeat(32)

async function exists(Key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket, Key }))
    return true
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false
    throw e
  }
}

let failed = 0
function assert(ok, msg) {
  if (!ok) {
    failed++
    console.error(`FAIL ${msg}`)
  }
}

await client.send(new PutObjectCommand({ Bucket, Key: key, Body: 'jpeg', ContentType: 'image/jpeg' }))
await supabase.from('receipts').delete().eq('image_sha256', H)
const { data: row, error } = await supabase
  .from('receipts')
  .insert({ s3_key: key, file_name: 'verify.jpg', image_sha256: H })
  .select('id')
  .single()
if (error) throw error

try {
  const res = await fetch(`${BASE}/api/admin/receipts/${row.id}`, { method: 'DELETE', headers: { Cookie: COOKIE } })
  assert(res.status === 200, `delete → 200, got ${res.status} ${await res.text()}`)
  assert((await getReceipt(row.id)) === null, 'row removed')
  assert(!(await exists(key)), `photo gone from ${key}`)
  assert(await exists(archived), `photo moved to ${archived}`)
} finally {
  await supabase.from('receipts').delete().eq('id', row.id)
  for (const Key of [key, archived]) await client.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => {})
}

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS — all 4 cases')
