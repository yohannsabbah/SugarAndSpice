import 'server-only'
import { S3Client } from '@aws-sdk/client-s3'

// One bucket serves the TV media and the receipt photos, under separate
// prefixes. The env var names predate receipts and stay as-is so the
// deployment does not need new config.
export const S3_REGION = 'us-east-1'

export function s3Client() {
  const accessKeyId = process.env.TV_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.TV_S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('TV_S3_ACCESS_KEY_ID / TV_S3_SECRET_ACCESS_KEY are not configured')
  }
  return new S3Client({
    region: S3_REGION,
    credentials: { accessKeyId, secretAccessKey },
  })
}

export function s3Bucket() {
  const Bucket = process.env.TV_S3_BUCKET
  if (!Bucket) throw new Error('TV_S3_BUCKET is not configured')
  return Bucket
}
