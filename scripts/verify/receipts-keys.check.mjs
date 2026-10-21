import {
  receiptS3Key,
  isSha256,
  isReceiptKey,
  keyMatchesHash,
} from '../../src/lib/receipts/keys.js'

const H = 'ab'.repeat(32)

const cases = [
  // receiptS3Key — Israel time, not UTC
  ['key 31 Oct 22:30Z is Nov in Israel', receiptS3Key(new Date('2026-10-31T22:30:00Z'), H), `receipts/11_2026/${Date.parse('2026-10-31T22:30:00Z')}-abababab.jpg`],
  ['key zero-pads the month', receiptS3Key(new Date('2026-03-05T10:00:00Z'), H).startsWith('receipts/03_2026/'), true],
  ['key 31 Dec 21:59Z is still Dec', receiptS3Key(new Date('2026-12-31T21:59:00Z'), H).startsWith('receipts/12_2026/'), true],
  ['key 31 Dec 22:01Z is Jan next year', receiptS3Key(new Date('2026-12-31T22:01:00Z'), H).startsWith('receipts/01_2027/'), true],
  // isSha256
  ['sha lowercase hex', isSha256(H), true],
  ['sha rejects uppercase', isSha256(H.toUpperCase()), false],
  ['sha rejects 63 chars', isSha256(H.slice(1)), false],
  ['sha rejects undefined', isSha256(undefined), false],
  // isReceiptKey
  ['key valid', isReceiptKey('receipts/10_2026/1760000000000-abababab.jpg'), true],
  ['key rejects traversal', isReceiptKey('receipts/10_2026/../tv/tv-media.json'), false],
  ['key rejects other prefix', isReceiptKey('tv/1760000000000-abababab.jpg'), false],
  // keyMatchesHash
  ['hash matches key', keyMatchesHash('receipts/10_2026/1-abababab.jpg', H), true],
  ['hash mismatch', keyMatchesHash('receipts/10_2026/1-cdcdcdcd.jpg', H), false],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
