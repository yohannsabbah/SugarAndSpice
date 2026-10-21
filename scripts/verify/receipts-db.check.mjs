// Runs findReceiptByHash / createReceipt against the real Supabase project,
// then deletes the test row.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-db.check.mjs
import { findReceiptByHash, createReceipt } from '@/lib/db/receipts'
import { supabase } from '@/lib/supabase'

const H = 'f0'.repeat(32)
const KEY = 'receipts/00_0000/1-f0f0f0f0.jpg'

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`)
    process.exit(1)
  }
}

// start clean
await supabase.from('receipts').delete().eq('image_sha256', H)

assert((await findReceiptByHash(H)) === null, 'no row before create')

const a = await createReceipt({ s3Key: KEY, fileName: 'IMG_0001.HEIC', sha256: H, uploadedBy: null })
assert(a.created === true && typeof a.id === 'string', `first create: ${JSON.stringify(a)}`)

const b = await createReceipt({ s3Key: KEY, fileName: 'IMG_0001.HEIC', sha256: H, uploadedBy: null })
assert(b.created === false && b.id === a.id, `second create returns the same row: ${JSON.stringify(b)}`)

const found = await findReceiptByHash(H)
assert(found?.id === a.id, `find by hash: ${JSON.stringify(found)}`)

const { data: row, error } = await supabase.from('receipts').select('*').eq('id', a.id).single()
assert(!error, `read row: ${error?.message}`)
assert(
  row.parse_status === 'pending' && Number(row.vat_rate) === 0.18 && row.currency === 'ILS',
  `defaults: ${JSON.stringify({ parse_status: row.parse_status, vat_rate: row.vat_rate, currency: row.currency })}`,
)

// cleanup
await supabase.from('receipts').delete().eq('id', a.id)

console.log('PASS')
