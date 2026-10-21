import 'server-only'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { S3_REGION, s3Bucket, s3Client } from '@/lib/s3'

export const TV_S3_REGION = S3_REGION
export const TV_S3_KEY = 'tv/tv-media.json'

export const tvS3Client = s3Client
const bucket = s3Bucket

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
