import { vatAmount, netAmount, summarizeReceipts } from '../../src/lib/receipts/money.js'
import { findDuplicateOf } from '../../src/lib/receipts/duplicates.js'

const row = (o) => ({ purchased_time: null, receipt_number: null, ...o })

const cases = [
  ['vat of the reference receipt', vatAmount(48.6), 7.41],
  ['vat of 100', vatAmount(100), 15.25],
  ['vat of 0', vatAmount(0), 0],
  ['vat of null', vatAmount(null), null],
  ['net of the reference receipt', netAmount(48.6, 7.41), 41.19],
  ['summary skips duplicates', summarizeReceipts([{ total: 48.6, vat_amount: 7.41 }, { total: 10, vat_amount: 1.53, duplicate_of: 'a' }, { total: null, vat_amount: null }]), { count: 2, total: 48.6, vat: 7.41 }],
  ['dup by time', findDuplicateOf(row({ id: 'n', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38' }), [row({ id: 'a', purchased_at: '2026-10-21', total: '48.60', purchased_time: '20:23:38' })]), 'a'],
  ['dup by receipt number', findDuplicateOf(row({ id: 'n', purchased_at: '2026-10-21', total: 48.6, receipt_number: '614461' }), [row({ id: 'a', purchased_at: '2026-10-21', total: 48.6, receipt_number: '614461' })]), 'a'],
  ['two real 10.90 purchases', findDuplicateOf(row({ id: 'n', purchased_at: '2026-10-21', total: 10.9 }), [row({ id: 'a', purchased_at: '2026-10-21', total: 10.9 })]), null],
  ['different times', findDuplicateOf(row({ id: 'n', purchased_at: '2026-10-21', total: 10.9, purchased_time: '10:00:00' }), [row({ id: 'a', purchased_at: '2026-10-21', total: 10.9, purchased_time: '11:00:00' })]), null],
  ['not itself', findDuplicateOf(row({ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38' }), [row({ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38' })]), null],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
