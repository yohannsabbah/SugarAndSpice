// The Claude request that reads a receipt photo, and the parser for its
// answer. Pure: no SDK import, so the verify scripts can run it without a key.
// processReceipt.js sends it through AnthropicBedrock (bedrock-runtime InvokeModel).

// Claude Haiku 4.5 through the US cross-region inference profile. The owner's
// AWS account is not approved for the 5.x models on Bedrock. Haiku 4.5
// rejects `effort`, so the request does not send it.
export const EXTRACTION_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] })

export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['purchased_at', 'purchased_time', 'vendor', 'receipt_number', 'total', 'legible'],
  properties: {
    purchased_at: nullable('string'),
    purchased_time: nullable('string'),
    vendor: nullable('string'),
    receipt_number: nullable('string'),
    total: nullable('number'),
    legible: { type: 'boolean' },
  },
}

const PROMPT =
  'This is a photo of a purchase receipt, usually Israeli and in Hebrew. ' +
  'Read: purchased_at as YYYY-MM-DD; purchased_time as HH:MM:SS (24-hour) if printed; ' +
  'vendor as the business name printed at the top; ' +
  "receipt_number as the receipt or tax-invoice number (מס' קבלה / חשבונית מס); " +
  'total as the final amount paid (סה"כ לתשלום) as a number. ' +
  'Use null for any field you cannot read with confidence. A wrong value is worse than null. ' +
  'Set legible to false if the photo is not a readable receipt.'

export function buildExtractionRequest(jpegBase64) {
  return {
    model: EXTRACTION_MODEL,
    max_tokens: 2000,
    output_config: {
      format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

function realDate(v) {
  const m = typeof v === 'string' && DATE_RE.exec(v.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const ok = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
  return ok ? m[0] : null
}

function clockTime(v) {
  const m = typeof v === 'string' && TIME_RE.exec(v.trim())
  return m ? `${m[1]}:${m[2]}:${m[3] || '00'}` : null
}

function amount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
}

function text(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

const DAY_MS = 24 * 60 * 60 * 1000

// Israeli receipts print DD/MM/YY, and a model can swap day and month or misread
// the year. A wrong date moves the receipt into another month's export, out of
// the owner's sight. Keep only dates from 90 days before the upload to 1 day
// after it. Anything else becomes null, so the row stays in its upload month.
export function plausibleDate(date, uploadedAt) {
  if (!date) return null
  // Whole days: the purchase date against the upload's calendar day.
  const day = Date.parse(`${date}T00:00:00Z`)
  const uploadDay = Date.parse(`${new Date(uploadedAt).toISOString().slice(0, 10)}T00:00:00Z`)
  return day >= uploadDay - 90 * DAY_MS && day <= uploadDay + DAY_MS ? date : null
}

// Turns the model's answer into the values stored on the row. Anything the
// model got malformed becomes null, for the owner to fill in.
export function parseExtraction(response) {
  if (response.stop_reason === 'refusal') throw new Error('Model refused')
  if (response.stop_reason === 'max_tokens') throw new Error('Model output was cut off')

  // Thinking blocks can come first; the answer is the first text block.
  const block = response.content.find((b) => b.type === 'text')
  if (!block) throw new Error('Model returned no text')
  const raw = JSON.parse(block.text)

  const fields = {
    purchased_at: realDate(raw.purchased_at),
    purchased_time: clockTime(raw.purchased_time),
    vendor: text(raw.vendor),
    receipt_number: text(raw.receipt_number),
    total: amount(raw.total),
  }
  const confident = raw.legible === true && fields.total !== null && fields.purchased_at !== null
  return { ...fields, ai_confidence: confident ? 'high' : 'low', raw }
}
