import {
  receiptS3Key,
  isSha256,
  isJpeg,
  MAX_RECEIPT_BYTES,
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
  // isJpeg — checks the bytes, not the declared type
  ['jpeg magic bytes', isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), true],
  ['png is not jpeg', isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false],
  ['too short', isJpeg(new Uint8Array([0xff, 0xd8])), false],
  // cap stays under the Amplify request body limit
  ['size cap is 4 MB', MAX_RECEIPT_BYTES, 4 * 1024 * 1024],
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
