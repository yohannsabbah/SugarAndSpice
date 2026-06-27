import 'server-only'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

function client() {
  const region = process.env.TV_S3_REGION
  const accessKeyId = process.env.TV_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.TV_S3_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('TV_S3_* environment variables are not configured')
  }
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function location() {
  const Bucket = process.env.TV_S3_BUCKET
  const Key = process.env.TV_S3_KEY
  if (!Bucket || !Key) throw new Error('TV_S3_BUCKET / TV_S3_KEY are not configured')
  return { Bucket, Key }
}

export async function readTvMedia() {
  const c = client()
  const { Bucket, Key } = location()
  const res = await c.send(new GetObjectCommand({ Bucket, Key }))
  const text = await res.Body.transformToString()
  return JSON.parse(text)
}

export async function writeTvMedia(data) {
  const c = client()
  const { Bucket, Key } = location()
  const body = JSON.stringify(data, null, 2) + '\n'
  await c.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-cache',
    }),
  )
}
