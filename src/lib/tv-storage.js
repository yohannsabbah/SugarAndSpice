import 'server-only'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

export const TV_S3_REGION = 'us-east-1'
export const TV_S3_KEY = 'tv/tv-media.json'

export function tvS3Client() {
  const accessKeyId = process.env.TV_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.TV_S3_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('TV_S3_ACCESS_KEY_ID / TV_S3_SECRET_ACCESS_KEY are not configured')
  }
  return new S3Client({
    region: TV_S3_REGION,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function bucket() {
  const Bucket = process.env.TV_S3_BUCKET
  if (!Bucket) throw new Error('TV_S3_BUCKET is not configured')
  return Bucket
}

export async function readTvMedia() {
  const c = tvS3Client()
  const res = await c.send(new GetObjectCommand({ Bucket: bucket(), Key: TV_S3_KEY }))
  const text = await res.Body.transformToString()
  return JSON.parse(text)
}

export async function writeTvMedia(data) {
  const c = tvS3Client()
  const body = JSON.stringify(data, null, 2) + '\n'
  await c.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: TV_S3_KEY,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-cache',
    }),
  )
}
