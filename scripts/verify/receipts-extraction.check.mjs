import { buildExtractionRequest, parseExtraction, EXTRACTION_MODEL } from '../../src/lib/receipts/extraction.js'

const ok = (json) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }] })
const ref = { purchased_at: '2026-10-21', purchased_time: '20:23:38', vendor: ' גם סטוק נווה שאנן ', receipt_number: '614461', total: 48.6, legible: true }
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
  ['bedrock model id', req.model, 'anthropic.claude-haiku-5-5'],
  ['image before text', req.messages[0].content[0].type, 'image'],
  ['six required fields', req.output_config.format.schema.required.length, 6],
  ['no thinking param', 'thinking' in req, false],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (EXTRACTION_MODEL !== 'anthropic.claude-haiku-5-5') failed++
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
