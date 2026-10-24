// Exercises POST /api/admin/receipts/[id]/extract and /extract-pending on a
// running dev server. The throwaway row points at a photo that is not in S3,
// so extract fails before any model call and the row records the error.
// The sweep itself (which calls the model) is covered by the browser check.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-extract-api.check.mjs [baseUrl]
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'

const BASE = process.argv[2] || 'http://localhost:3000'
const COOKIE = `ss_admin=${createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')}`
const H = 'e1'.repeat(32)

async function post(path, { auth = true } = {}) {
  const r = await fetch(`${BASE}/api/admin/receipts/${path}`, {
    method: 'POST',
    headers: auth ? { Cookie: COOKIE } : {},
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

await supabase.from('receipts').delete().eq('image_sha256', H)
const { data: row, error } = await supabase
  .from('receipts')
  .insert({ s3_key: 'receipts/00_0000/1-e1e1e1e1.jpg', file_name: 'verify.jpg', image_sha256: H, parse_status: 'error' })
  .select('id')
  .single()
if (error) throw error
const id = row.id

let failed = 0
function expect(name, got, ok) {
  if (!ok) {
    failed++
    console.error(`FAIL ${name}: ${got.status} ${JSON.stringify(got.body)}`)
  }
}

try {
  let r = await post(`${id}/extract`, { auth: false })
  expect('extract, no cookie → 401', r, r.status === 401)
  r = await post('extract-pending', { auth: false })
  expect('extract-pending, no cookie → 401', r, r.status === 401)
  r = await post('00000000-0000-0000-0000-000000000000/extract')
  expect('extract, unknown id → 404', r, r.status === 404)
  r = await post(`${id}/extract`)
  expect(
    'extract, photo missing → 200, status error, row error stored',
    r,
    r.status === 200 && r.body.status === 'error' && r.body.receipt?.parse_status === 'error' && !!r.body.receipt?.parse_error,
  )
} finally {
  await supabase.from('receipts').delete().eq('id', id)
}

if (failed) {
  console.error(`${failed} case(s) failed`)
  process.exit(1)
}
console.log('PASS — all 4 cases')
