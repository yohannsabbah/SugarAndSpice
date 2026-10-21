import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Bucket, s3Client } from '@/lib/s3'
import { MAX_RECEIPT_BYTES, isSha256, receiptS3Key } from '@/lib/receipts/keys'
import { findReceiptByHash } from '@/lib/db/receipts'

export const dynamic = 'force-dynamic'

// Public, like /api/shifts/*: the employee screens carry no login.
export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  const { sha256, size } = body
  if (!isSha256(sha256)) {
    return NextResponse.json({ error: 'sha256 must be 64 lowercase hex characters' }, { status: 400 })
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_RECEIPT_BYTES) {
    return NextResponse.json({ error: `size must be 1 to ${MAX_RECEIPT_BYTES} bytes` }, { status: 400 })
  }

  try {
    if (await findReceiptByHash(sha256)) {
      return NextResponse.json({ duplicate: true })
    }

    const key = receiptS3Key(new Date(), sha256)
    // ContentLength is signed, so S3 rejects a body of any other size.
    const command = new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ContentType: 'image/jpeg',
      ContentLength: size,
    })
    const url = await getSignedUrl(s3Client(), command, { expiresIn: 300 })
    return NextResponse.json({ duplicate: false, url, key })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
