import { periodNumForDate } from '../../src/lib/parsers/wolt/period.js'

const cases = [
  ['2026-04-01', { year: 2026, num: 7 }],
  ['2026-04-15', { year: 2026, num: 7 }],
  ['2026-04-16', { year: 2026, num: 8 }],
  ['2026-04-30', { year: 2026, num: 8 }],
  ['2026-05-01T09:30:00', { year: 2026, num: 9 }],
  ['2026-12-16', { year: 2026, num: 24 }],
  ['2026-01-01', { year: 2026, num: 1 }],
]

let failed = 0
for (const [input, expected] of cases) {
  const actual = periodNumForDate(input)
  const ok = actual.year === expected.year && actual.num === expected.num
  if (!ok) {
    failed++
    console.error(`FAIL ${input}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
