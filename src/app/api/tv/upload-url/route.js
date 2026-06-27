import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { isAdmin } from '@/lib/admin'
import { tvS3Client } from '@/lib/tv-storage'

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

  const bucket = process.env.TV_S3_BUCKET
  if (!bucket) {
    return NextResponse.json({ error: 'TV_S3_BUCKET is not configured' }, { status: 500 })
  }

  const ext = extOf(filename)
  const safeName = `${Date.now()}-${sanitize(filename)}${ext ? '.' + ext : ''}`
  const key = `tv/${safeName}`

  let url
  try {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
    url = await getSignedUrl(tvS3Client(), command, { expiresIn: 300 })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  return NextResponse.json({ url, file: safeName, key })
}
