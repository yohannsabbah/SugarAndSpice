// End-to-end check of processReceipt on the owner's reference receipt: real
// Supabase, real S3, real Claude on Bedrock. Leaves both IMG_9420 rows pending
// and empty at the end, so the admin page sweep reads them for the owner.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-process.check.mjs
import { processReceipt } from '@/lib/receipts/processReceipt'
import { getReceipt, updateReceipt } from '@/lib/db/receipts'
import { supabase } from '@/lib/supabase'

if (!process.env.BEDROCK_AWS_ACCESS_KEY_ID) {
  console.error('SKIP: no BEDROCK_AWS_ACCESS_KEY_ID')
  process.exit(1)
}

const EMPTY = {
  purchased_at: null, purchased_time: null, vendor: null, receipt_number: null, total: null,
  vat_amount: null, duplicate_of: null, parse_status: 'pending', parse_error: null,
  parsed_at: null, reviewed_at: null, ai_confidence: null, raw_extraction: null,
}

const { data: refs } = await supabase.from('receipts').select('id').eq('file_name', 'IMG_9420.jpeg').order('uploaded_at')
if (refs?.length !== 2) {
  console.error(`FAIL expected exactly two IMG_9420.jpeg rows, found ${refs?.length}`)
  process.exit(1)
}
const [ID_5F0E, ID_1695] = refs.map((r) => r.id)

let failed = 0
function assert(ok, msg) {
  if (!ok) {
    failed++
    console.error(`FAIL ${msg}`)
  }
}

try {
  await updateReceipt(ID_5F0E, EMPTY)
  await updateReceipt(ID_1695, EMPTY)

  const a = await processReceipt(ID_5F0E)
  const b = await processReceipt(ID_1695)
  assert(a.status === 'parsed' && b.status === 'parsed', `both parsed: ${JSON.stringify([a, b])}`)

  const A = await getReceipt(ID_5F0E)
  const B = await getReceipt(ID_1695)
  console.log('read:', JSON.stringify({ date: A.purchased_at, time: A.purchased_time, vendor: A.vendor, number: A.receipt_number, total: A.total, vat: A.vat_amount, confidence: A.ai_confidence, error: A.parse_error }))
  assert(A.purchased_at === '2026-10-21', `date ${A.purchased_at}`)
  assert(A.purchased_time === '20:23:38', `time ${A.purchased_time}`)
  assert(Number(A.total) === 48.6, `total ${A.total}`)
  assert(Number(A.vat_amount) === 7.41, `vat ${A.vat_amount}`)
  assert(A.receipt_number === '614461', `receipt number ${A.receipt_number}`)
  assert((A.vendor || '').includes('גם סטוק'), `vendor ${A.vendor}`)
  assert(A.duplicate_of === null, 'first upload is not a duplicate')
  assert(B.duplicate_of === ID_5F0E, `second upload is a duplicate of the first: ${B.duplicate_of}`)

  // A reviewed row is never overwritten.
  await updateReceipt(ID_5F0E, { vendor: 'Owner edit', parse_status: 'reviewed' })
  assert((await processReceipt(ID_5F0E)).status === 'skipped', 'reviewed row is skipped')
  assert((await getReceipt(ID_5F0E)).vendor === 'Owner edit', 'reviewed vendor kept')

  // A model refusal becomes an error row, not a crash.
  const refusing = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } }
  await updateReceipt(ID_1695, EMPTY)
  assert((await processReceipt(ID_1695, { client: refusing })).status === 'error', 'refusal → error')
  assert((await getReceipt(ID_1695)).parse_error === 'Model refused', 'refusal message stored')
} catch (e) {
  failed++
  console.error(`FAIL threw: ${e.message}`)
} finally {
  await updateReceipt(ID_5F0E, EMPTY)
  await updateReceipt(ID_1695, EMPTY)
}

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS')
