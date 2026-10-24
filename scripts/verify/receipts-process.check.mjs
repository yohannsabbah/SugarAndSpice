// End-to-end check of processReceipt: real Supabase, real S3, and one real
// Claude call on Bedrock. It works only on throwaway rows that point at the
// owner's reference photo (IMG_9420.jpeg), and deletes them at the end. The
// owner's own rows are read, never written.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-process.check.mjs
import { processReceipt, CLIENT_OPTIONS } from '@/lib/receipts/processReceipt'
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
// The duplicate cases use an amount no real receipt in the table has.
const STUB = { purchased_at: '2026-10-21', purchased_time: '09:09:09', vendor: 'Verify', receipt_number: null, total: 12.34, legible: true }
const answer = (o = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...STUB, ...o }) }] })
const stub = (create) => ({ messages: { create } })
const HASHES = ['f1', 'f2', 'f3'].map((h) => h.repeat(32))

const { data: owner, error: ownerErr } = await supabase
  .from('receipts')
  .select('id, s3_key, updated_at')
  .eq('file_name', 'IMG_9420.jpeg')
  .order('uploaded_at')
if (ownerErr || !owner?.length) {
  console.error('FAIL the reference photo IMG_9420.jpeg is not in the table')
  process.exit(1)
}

await supabase.from('receipts').delete().in('image_sha256', HASHES)
const insert = (sha, uploaded_at) =>
  supabase
    .from('receipts')
    .insert({ s3_key: owner[0].s3_key, file_name: 'verify-process.jpg', image_sha256: sha, ...(uploaded_at ? { uploaded_at } : {}) })
    .select('id')
    .single()
    .then(({ data, error }) => {
      if (error) throw error
      return data.id
    })
const R = await insert(HASHES[0]) // real model call, uploaded now
const X = await insert(HASHES[1], '2026-10-23T06:11:00Z') // earlier upload
const Y = await insert(HASHES[2], '2026-10-23T06:12:00Z') // later upload

let failed = 0
function assert(ok, msg) {
  if (!ok) {
    failed++
    console.error(`FAIL ${msg}`)
  }
}

try {
  assert(CLIENT_OPTIONS.timeout <= 30000 && CLIENT_OPTIONS.maxRetries <= 1, `client fails fast: ${JSON.stringify(CLIENT_OPTIONS)}`)

  // The reference receipt, read by the real model.
  const r = await processReceipt(R)
  const row = await getReceipt(R)
  console.log('read:', JSON.stringify({ date: row.purchased_at, time: row.purchased_time, vendor: row.vendor, number: row.receipt_number, total: row.total, vat: row.vat_amount, confidence: row.ai_confidence, error: row.parse_error }))
  assert(r.status === 'parsed', `real read parsed: ${JSON.stringify(r)}`)
  assert(row.purchased_at === '2026-10-21', `date ${row.purchased_at}`)
  assert(row.purchased_time === '20:23:38', `time ${row.purchased_time}`)
  assert(Number(row.total) === 48.6, `total ${row.total}`)
  assert(Number(row.vat_amount) === 7.41, `vat ${row.vat_amount}`)
  assert(row.receipt_number === '614461', `receipt number ${row.receipt_number}`)
  assert((row.vendor || '').includes('גם סטוק'), `vendor ${row.vendor}`)

  // The later upload is read first: the earlier upload still becomes the original.
  await processReceipt(Y, { client: stub(async () => answer()) })
  await processReceipt(X, { client: stub(async () => answer()) })
  assert((await getReceipt(X)).duplicate_of === null, 'earlier upload is the original')
  assert((await getReceipt(Y)).duplicate_of === X, `later upload points at the earlier one: ${(await getReceipt(Y)).duplicate_of}`)

  // A reviewed row is never overwritten.
  await updateReceipt(X, { vendor: 'Owner edit', parse_status: 'reviewed' })
  assert((await processReceipt(X)).status === 'skipped', 'reviewed row is skipped')
  assert((await getReceipt(X)).vendor === 'Owner edit', 'reviewed vendor kept')

  // The owner edits the row while the model is reading it: the edit wins.
  await updateReceipt(X, EMPTY)
  const editsDuringCall = stub(async () => {
    await updateReceipt(X, { vendor: 'Owner edit', parse_status: 'reviewed' })
    return answer()
  })
  const during = await processReceipt(X, { client: editsDuringCall })
  const afterEdit = await getReceipt(X)
  assert(during.status === 'skipped', `edit during the call → skipped: ${JSON.stringify(during)}`)
  assert(afterEdit.vendor === 'Owner edit' && afterEdit.parse_status === 'reviewed', `edit during the call kept: ${afterEdit.vendor} ${afterEdit.parse_status}`)

  // The owner edits, then the model call fails: the row stays reviewed.
  await updateReceipt(X, EMPTY)
  const editsThenFails = stub(async () => {
    await updateReceipt(X, { vendor: 'Owner edit', parse_status: 'reviewed' })
    throw new Error('boom')
  })
  await processReceipt(X, { client: editsThenFails })
  const afterFail = await getReceipt(X)
  assert(afterFail.parse_status === 'reviewed' && afterFail.parse_error === null, `failure after an edit keeps it reviewed: ${afterFail.parse_status} ${afterFail.parse_error}`)

  // A day/month swap would move the receipt to March: the date is dropped instead.
  await updateReceipt(X, EMPTY)
  await processReceipt(X, { client: stub(async () => answer({ purchased_at: '2026-03-10' })) })
  const swapped = await getReceipt(X)
  assert(swapped.purchased_at === null && swapped.ai_confidence === 'low', `implausible date dropped: ${swapped.purchased_at} ${swapped.ai_confidence}`)

  // A model refusal becomes an error row, not a crash.
  await updateReceipt(X, EMPTY)
  const refusing = stub(async () => ({ stop_reason: 'refusal', content: [] }))
  assert((await processReceipt(X, { client: refusing })).status === 'error', 'refusal → error')
  assert((await getReceipt(X)).parse_error === 'Model refused', 'refusal message stored')

  // The owner's rows were never written.
  const { data: ownerAfter } = await supabase.from('receipts').select('id, updated_at').in('id', owner.map((o) => o.id))
  for (const o of owner) {
    assert(ownerAfter.find((a) => a.id === o.id)?.updated_at === o.updated_at, `owner row ${o.id.slice(0, 8)} untouched`)
  }
} catch (e) {
  failed++
  console.error(`FAIL threw: ${e.message}`)
} finally {
  await supabase.from('receipts').update({ duplicate_of: null }).in('id', [R, X, Y])
  await supabase.from('receipts').delete().in('id', [R, X, Y])
}

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS')
