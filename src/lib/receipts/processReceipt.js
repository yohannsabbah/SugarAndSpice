import 'server-only'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { s3Bucket, s3Client } from '@/lib/s3'
import { getReceipt, listDuplicateCandidates, updateReceipt } from '@/lib/db/receipts'
import { buildExtractionRequest, parseExtraction } from '@/lib/receipts/extraction'
import { VAT_RATE, vatAmount } from '@/lib/receipts/money'
import { findDuplicateOf } from '@/lib/receipts/duplicates'

// Bedrock keys of their own, not AWS_*: Amplify reserves that prefix.
function bedrockClient() {
  const awsAccessKey = process.env.BEDROCK_AWS_ACCESS_KEY_ID
  const awsSecretKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY
  if (!awsAccessKey || !awsSecretKey) return null
  return new AnthropicBedrock({
    awsRegion: process.env.BEDROCK_AWS_REGION || 'us-east-1',
    awsAccessKey,
    awsSecretKey,
  })
}

// Reads one receipt photo with Claude and stores what it found. Never throws:
// a failure is stored on the row for the owner to see and retry. A row the
// owner reviewed is never overwritten. Without Bedrock keys the row stays
// pending, so it is read once the keys are configured.
export async function processReceipt(id, { client } = {}) {
  const row = await getReceipt(id)
  if (!row || row.parse_status === 'reviewed') return { status: 'skipped' }
  const claude = client || bedrockClient()
  if (!claude) return { status: 'skipped' }

  try {
    const object = await s3Client().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: row.s3_key }))
    const jpeg = Buffer.from(await object.Body.transformToByteArray()).toString('base64')
    const { raw, ai_confidence, ...fields } = parseExtraction(await claude.messages.create(buildExtractionRequest(jpeg)))

    let duplicateOf = null
    if (fields.purchased_at && fields.total !== null) {
      const candidates = await listDuplicateCandidates({ purchasedAt: fields.purchased_at, total: fields.total, excludeId: id })
      duplicateOf = findDuplicateOf({ id, ...fields }, candidates)
    }

    await updateReceipt(id, {
      ...fields,
      ai_confidence,
      raw_extraction: raw,
      vat_rate: VAT_RATE,
      vat_amount: vatAmount(fields.total),
      duplicate_of: duplicateOf,
      parse_status: 'parsed',
      parsed_at: new Date().toISOString(),
      parse_error: null,
    })
    return duplicateOf ? { status: 'parsed', duplicateOf } : { status: 'parsed' }
  } catch (e) {
    await updateReceipt(id, { parse_status: 'error', parse_error: String(e?.message || e).slice(0, 300) }).catch(() => {})
    return { status: 'error' }
  }
}
