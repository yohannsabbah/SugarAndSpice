// Runs the admin-side receipts queries against the real Supabase project with
// three throwaway rows, then deletes them.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-admin-db.check.mjs
import {
  listReceiptsForMonth,
  getReceipt,
  updateReceipt,
  deleteReceipt,
  listDuplicateCandidates,
  countPendingReceipts,
} from '@/lib/db/receipts'
import { supabase } from '@/lib/supabase'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function insert(row) {
  const { data, error } = await supabase.from('receipts').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

const base = (n) => ({ s3_key: `receipts/00_0000/${n}-e${n}e${n}e${n}e${n}.jpg`, file_name: 'verify.jpg' })
const ids = []
let failed = false

try {
  await supabase.from('receipts').delete().in('image_sha256', ['e1', 'e2', 'e3'].map((h) => h.repeat(32)))

  const A = await insert({ ...base(1), image_sha256: 'e1'.repeat(32), purchased_at: '2026-03-10', total: 10.9, purchased_time: '09:15:00' })
  ids.push(A)
  // 22:30 UTC on 31 March is 01:30 on 1 April in Israel.
  const B = await insert({ ...base(2), image_sha256: 'e2'.repeat(32), uploaded_at: '2026-03-31T22:30:00Z' })
  ids.push(B)
  const C = await insert({ ...base(3), image_sha256: 'e3'.repeat(32), purchased_at: '2026-03-10', total: 10.9, duplicate_of: A })
  ids.push(C)

  const march = (await listReceiptsForMonth('2026-03')).map((r) => r.id)
  assert(march.includes(A) && march.includes(C), `March lists A and C: ${march}`)
  assert(!march.includes(B), 'March excludes B (uploaded 1 April in Israel)')

  const april = (await listReceiptsForMonth('2026-04')).map((r) => r.id)
  assert(april.includes(B), 'April lists B by its Israel upload date')

  const cands = (await listDuplicateCandidates({ purchasedAt: '2026-03-10', total: 10.9, excludeId: B })).map((r) => r.id)
  // Rows already marked as copies are candidates too: duplicatePlan needs them
  // to keep the earliest upload as the original.
  assert(cands.length === 2 && cands.includes(A) && cands.includes(C), `candidates are A and C: ${cands}`)

  const updated = await updateReceipt(A, { vendor: 'Test' })
  assert(updated.vendor === 'Test', `update returns the row: ${updated.vendor}`)

  assert(typeof (await countPendingReceipts()) === 'number', 'pending count is a number')
} catch (e) {
  failed = true
  console.error(`FAIL ${e.message}`)
} finally {
  for (const id of ids) await deleteReceipt(id)
}

if (!failed && ids.length && (await getReceipt(ids[0])) !== null) {
  failed = true
  console.error('FAIL deleteReceipt left the row')
}
if (failed) process.exit(1)
console.log('PASS')
