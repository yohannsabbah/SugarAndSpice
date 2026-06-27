import { NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime|ogg))$/

function sanitize(name) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file'
}

function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const { filename, contentType } = body
  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType are required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.test(contentType)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  const region = process.env.TV_S3_REGION
  const bucket = process.env.TV_S3_BUCKET
  const accessKeyId = process.env.TV_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.TV_S3_SECRET_ACCESS_KEY
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    return NextResponse.json({ error: 'S3 not configured' }, { status: 500 })
  }

  const ext = extOf(filename)
  const safeName = `${Date.now()}-${sanitize(filename)}${ext ? '.' + ext : ''}`
  const key = `tv/${safeName}`

  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
  const url = await getSignedUrl(client, command, { expiresIn: 300 })

  return NextResponse.json({ url, file: safeName, key })
}
