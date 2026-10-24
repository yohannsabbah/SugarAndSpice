import 'server-only'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { s3Bucket, s3Client } from '@/lib/s3'
import { getReceipt, getReceiptVendor, listDuplicateCandidates, updateReceiptIfStatus } from '@/lib/db/receipts'
import { buildExtractionRequest, parseExtraction, plausibleDate } from '@/lib/receipts/extraction'
import { VAT_RATE, vatAmount } from '@/lib/receipts/money'
import { duplicatePlan } from '@/lib/receipts/duplicates'

// The SDK default is a 10-minute timeout with 2 retries. A slow or throttled
// call must fail inside the host's time limit, so the row records an error
// instead of staying pending forever.
export const CLIENT_OPTIONS = { timeout: 20_000, maxRetries: 1 }

// Statuses a read may overwrite. Never 'reviewed': the owner's edits win.
const READABLE = ['pending', 'error']

// Bedrock keys of their own, not AWS_*: Amplify reserves that prefix.
function bedrockClient() {
  const awsAccessKey = process.env.BEDROCK_AWS_ACCESS_KEY_ID
  const awsSecretKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY
  if (!awsAccessKey || !awsSecretKey) return null
  return new AnthropicBedrock({
    awsRegion: process.env.BEDROCK_AWS_REGION || 'us-east-1',
    awsAccessKey,
    awsSecretKey,
    ...CLIENT_OPTIONS,
  })
}

// Points this row at its original, or points later copies at this row.
async function markDuplicates(row) {
  const candidates = await listDuplicateCandidates({ purchasedAt: row.purchased_at, total: row.total, excludeId: row.id })
  const { duplicateOf, copies } = duplicatePlan(row, candidates)
  if (duplicateOf) await updateReceiptIfStatus(row.id, ['parsed'], { duplicate_of: duplicateOf })
  for (const copyId of copies) await updateReceiptIfStatus(copyId, ['parsed'], { duplicate_of: row.id })
  return duplicateOf
}

// Reads one receipt photo with Claude and stores what it found. Never throws:
// a failure is stored on the row for the owner to see and retry. Every write
// is guarded by status, so an owner edit made during the model call wins.
// Without Bedrock keys the row stays pending, so it is read once the keys exist.
export async function processReceipt(id, { client } = {}) {
  try {
    const row = await getReceipt(id)
    if (!row || !READABLE.includes(row.parse_status)) return { status: 'skipped' }
    const claude = client || bedrockClient()
    if (!claude) return { status: 'skipped' }

    try {
      const object = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: row.s3_key }))
      const jpeg = Buffer.from(await object.Body.transformToByteArray()).toString('base64')
      const { raw, ai_confidence, ...fields } = parseExtraction(await claude.messages.create(buildExtractionRequest(jpeg)))

      const purchased_at = plausibleDate(fields.purchased_at, row.uploaded_at)
      // The owner named this business before: their name and category win.
      const known = fields.business_id ? await getReceiptVendor(fields.business_id) : null
      const saved = await updateReceiptIfStatus(id, READABLE, {
        ...fields,
        vendor: known?.vendor || fields.vendor,
        category: known?.category || fields.category,
        purchased_at,
        ai_confidence: purchased_at === fields.purchased_at ? ai_confidence : 'low',
        raw_extraction: raw,
        vat_rate: VAT_RATE,
        vat_amount: vatAmount(fields.total),
        duplicate_of: null,
        parse_status: 'parsed',
        parsed_at: new Date().toISOString(),
        parse_error: null,
      })
      if (!saved) return { status: 'skipped' }

      // Matched after this row's own fields are stored, so of two reads that
      // run at the same time, the later one always sees the other.
      const duplicateOf = saved.purchased_at && saved.total !== null ? await markDuplicates(saved) : null
      return duplicateOf ? { status: 'parsed', duplicateOf } : { status: 'parsed' }
    } catch (e) {
      await updateReceiptIfStatus(id, READABLE, { parse_status: 'error', parse_error: String(e?.message || e).slice(0, 300) })
      return { status: 'error' }
    }
  } catch {
    return { status: 'error' } // the database itself failed; the row is unchanged
  }
}
