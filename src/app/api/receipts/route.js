import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3Bucket, s3Client } from '@/lib/s3'
import { MAX_RECEIPT_BYTES, isJpeg, isSha256, receiptS3Key } from '@/lib/receipts/keys'
import { createReceipt, findReceiptByHash } from '@/lib/db/receipts'
import { getEmployee } from '@/lib/db/employees'

export const dynamic = 'force-dynamic'

// The uploader is recorded when known, but never blocks the upload: the
// employee may not have picked a name yet, or the stored id may be stale.
async function resolveUploader(employeeId) {
  if (typeof employeeId !== 'string' || !employeeId) return null
  try {
    const employee = await getEmployee(employeeId)
    return employee ? employee.id : null
  } catch {
    return null // e.g. not a uuid (Postgres 22P02)
  }
}

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 })
}

// Receives a receipt photo from the employee screens, stores it in S3, and
// records it. Public, like /api/shifts/*. The browser never talks to S3.
//
// multipart/form-data fields:
//   photo       the downscaled JPEG
//   sha256      hash of the ORIGINAL file, computed in the browser (dedup key)
//   fileName    the original file name, for the admin page
//   employeeId  optional
export async function POST(req) {
  const form = await req.formData().catch(() => null)
  if (!form) return badRequest('Expected multipart/form-data')

  const photo = form.get('photo')
  const sha256 = form.get('sha256')
  if (!(photo instanceof Blob)) return badRequest('photo is required')
  if (!isSha256(sha256)) return badRequest('sha256 must be 64 lowercase hex characters')
  if (photo.size > MAX_RECEIPT_BYTES) return badRequest('photo is too large')

  const bytes = new Uint8Array(await photo.arrayBuffer())
  if (!isJpeg(bytes)) return badRequest('photo must be a JPEG')

  try {
    // A second upload of the same photo is not an error for the employee.
    const existing = await findReceiptByHash(sha256)
    if (existing) return NextResponse.json({ id: existing.id })

    const key = receiptS3Key(new Date(), sha256)
    // The row is written only after S3 confirms the object, so the server
    // never records a receipt that is not stored.
    await s3Client().send(
      new PutObjectCommand({ Bucket: s3Bucket(), Key: key, Body: bytes, ContentType: 'image/jpeg' }),
    )

    const rawName = form.get('fileName')
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 200) : ''
    const { id } = await createReceipt({
      s3Key: key,
      fileName: name || 'receipt.jpg',
      sha256,
      uploadedBy: await resolveUploader(form.get('employeeId')),
    })
    return NextResponse.json({ id })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
