// Exercises PATCH/DELETE /api/admin/receipts/[id] on a running dev server with
// one throwaway row (created and deleted here).
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-admin-api.check.mjs [baseUrl]
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'

const BASE = process.argv[2] || 'http://localhost:3000'
const COOKIE = `ss_admin=${createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')}`
const H = 'd0'.repeat(32)

async function call(method, id, body, { auth = true } = {}) {
  const r = await fetch(`${BASE}/api/admin/receipts/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: COOKIE } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

await supabase.from('receipts').delete().eq('image_sha256', H)
const { data: row, error } = await supabase
  .from('receipts')
  .insert({ s3_key: 'receipts/00_0000/1-d0d0d0d0.jpg', file_name: 'verify.jpg', image_sha256: H })
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
  let r = await call('PATCH', id, { vendor: 'x' }, { auth: false })
  expect('no cookie → 401', r, r.status === 401)
  r = await call('PATCH', id, { color: 'red' })
  expect('unknown field → 400', r, r.status === 400)
  r = await call('PATCH', id, { total: 'abc' })
  expect('bad total → 400', r, r.status === 400)
  r = await call('PATCH', id, { total: 48.6 })
  expect('total → 200, VAT 7.41, reviewed', r, r.status === 200 && Number(r.body.receipt.vat_amount) === 7.41 && r.body.receipt.parse_status === 'reviewed')
  r = await call('PATCH', id, { purchased_at: '2026-10-21', purchased_time: '20:23' })
  expect('date + time → 200, time 20:23:00', r, r.status === 200 && r.body.receipt.purchased_time === '20:23:00')
  r = await call('PATCH', id, { purchased_at: '2026-02-30' })
  expect('impossible date → 400', r, r.status === 400)
  r = await call('PATCH', id, { duplicate_of: '00000000-0000-0000-0000-000000000000' })
  expect('setting duplicate_of → 400', r, r.status === 400)
  r = await call('PATCH', id, { vendor: '' })
  expect('empty vendor → null', r, r.status === 200 && r.body.receipt.vendor === null)
  r = await call('DELETE', id)
  expect('delete → 200', r, r.status === 200)
  r = await call('PATCH', id, { vendor: 'x' })
  expect('after delete → 404', r, r.status === 404)
} finally {
  await supabase.from('receipts').delete().eq('id', id)
}

if (failed) {
  console.error(`${failed} case(s) failed`)
  process.exit(1)
}
console.log('PASS — all 10 cases')
