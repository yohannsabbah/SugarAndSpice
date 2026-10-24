import { sortReceipts, needsCheck } from '../../src/lib/receipts/sortReceipts.js'

const row = (o) => ({ parse_status: 'parsed', ai_confidence: 'high', total: 10, purchased_at: '2026-10-20', uploaded_at: '2026-10-21T08:00:00Z', ...o })
const rows = [
  row({ id: 'good-late', purchased_at: '2026-10-22' }),
  row({ id: 'good-early', purchased_at: '2026-10-01' }),
  row({ id: 'unreadable', ai_confidence: 'low', total: null, purchased_at: null }),
  row({ id: 'pending', parse_status: 'pending', ai_confidence: null, total: null, purchased_at: null }),
  row({ id: 'error', parse_status: 'error', ai_confidence: null, total: null, purchased_at: null }),
  row({ id: 'reviewed-low', parse_status: 'reviewed', ai_confidence: 'low' }),
]

const cases = [
  ['order: error, pending, needs check, then by date', sortReceipts(rows).map((r) => r.id), ['error', 'pending', 'unreadable', 'good-early', 'reviewed-low', 'good-late']],
  ['low confidence needs a check', needsCheck(row({ ai_confidence: 'low' })), true],
  ['parsed without total needs a check', needsCheck(row({ total: null })), true],
  ['parsed without date needs a check', needsCheck(row({ purchased_at: null })), true],
  ['a reviewed row never needs a check', needsCheck(row({ parse_status: 'reviewed', ai_confidence: 'low', total: null })), false],
  ['a good parsed row needs no check', needsCheck(row({})), false],
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
