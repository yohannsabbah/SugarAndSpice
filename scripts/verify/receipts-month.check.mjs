import { receiptMonthBounds, currentIsraelMonth } from '../../src/lib/receipts/month.js'

const cases = [
  // IDT (+3) → IST (+2) change on 25 Oct 2026
  ['october bounds', receiptMonthBounds('2026-10'), { dateFrom: '2026-10-01', dateTo: '2026-11-01', uploadedFrom: '2026-09-30T21:00:00.000Z', uploadedTo: '2026-10-31T22:00:00.000Z' }],
  ['december rolls the year', receiptMonthBounds('2026-12').dateTo, '2027-01-01'],
  ['december upload end', receiptMonthBounds('2026-12').uploadedTo, '2026-12-31T22:00:00.000Z'],
  ['00:30 on 1 Nov in Israel', currentIsraelMonth(new Date('2026-10-31T22:30:00Z')), '2026-11'],
  ['23:30 on 31 Oct in Israel', currentIsraelMonth(new Date('2026-10-31T21:30:00Z')), '2026-10'],
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
