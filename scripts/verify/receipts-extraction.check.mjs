import { buildExtractionRequest, parseExtraction, plausibleDate, EXTRACTION_MODEL } from '../../src/lib/receipts/extraction.js'

const ok = (json) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }] })
const ref = { purchased_at: '2026-10-21', purchased_time: '20:23:38', vendor: ' גם סטוק נווה שאנן ', receipt_number: '614461', business_id: 'ח.פ 515235943', total: 48.6, category: 'ingredients', legible: true }
function throws(fn) {
  try {
    fn()
    return 'no error'
  } catch (e) {
    return e.message
  }
}
const req = buildExtractionRequest('QUJD')

const cases = [
  ['vendor trimmed', parseExtraction(ok(ref)).vendor, 'גם סטוק נווה שאנן'],
  ['confidence high', parseExtraction(ok(ref)).ai_confidence, 'high'],
  ['HH:MM gets seconds', parseExtraction(ok({ ...ref, purchased_time: '20:23' })).purchased_time, '20:23:00'],
  ['impossible date → null', parseExtraction(ok({ ...ref, purchased_at: '2026-02-30' })).purchased_at, null],
  ['negative total → null', parseExtraction(ok({ ...ref, total: -5 })).total, null],
  ['total rounded to cents', parseExtraction(ok({ ...ref, total: 48.604 })).total, 48.6],
  ['empty vendor → null', parseExtraction(ok({ ...ref, vendor: '' })).vendor, null],
  ['illegible → low', parseExtraction(ok({ ...ref, legible: false })).ai_confidence, 'low'],
  ['refusal', throws(() => parseExtraction({ stop_reason: 'refusal', content: [] })), 'Model refused'],
  ['cut off', throws(() => parseExtraction({ stop_reason: 'max_tokens', content: [] })), 'Model output was cut off'],
  ['model id', req.model, 'us.anthropic.claude-haiku-4-5-20251001-v1:0'],
  ['no effort param', 'effort' in req.output_config, false],
  ['image before text', req.messages[0].content[0].type, 'image'],
  ['eight required fields', req.output_config.format.schema.required.length, 8],
  ['business id digits only', parseExtraction(ok(ref)).business_id, '515235943'],
  ['short business id → null', parseExtraction(ok({ ...ref, business_id: '1234' })).business_id, null],
  ['category kept', parseExtraction(ok(ref)).category, 'ingredients'],
  ['unknown category → null', parseExtraction(ok({ ...ref, category: 'snacks' })).category, null],
  ['prompt lists categories', req.messages[0].content[1].text.includes('packaging'), true],
  ['no thinking param', 'thinking' in req, false],
  ['date 2 days before upload kept', plausibleDate('2026-10-21', '2026-10-23T06:11:00Z'), '2026-10-21'],
  ['DD/MM misread (March for October) → null', plausibleDate('2026-03-10', '2026-10-23T06:11:00Z'), null],
  ['date 89 days before upload kept', plausibleDate('2026-07-26', '2026-10-23T06:11:00Z'), '2026-07-26'],
  ['date 1 day after upload kept (time zones)', plausibleDate('2026-10-24', '2026-10-23T06:11:00Z'), '2026-10-24'],
  ['date 2 days after upload → null', plausibleDate('2026-10-25', '2026-10-23T06:11:00Z'), null],
  ['no date → null', plausibleDate(null, '2026-10-23T06:11:00Z'), null],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (EXTRACTION_MODEL !== 'us.anthropic.claude-haiku-4-5-20251001-v1:0') failed++
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
