import { createHash } from 'node:crypto'
import { after, NextResponse } from 'next/server'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Bucket, s3Client } from '@/lib/s3'
import { MAX_RECEIPT_BYTES, isJpeg, receiptS3Key } from '@/lib/receipts/keys'
import { createReceipt, findReceiptByHash, listRecentReceipts } from '@/lib/db/receipts'
import { getEmployee } from '@/lib/db/employees'
import { processReceipt } from '@/lib/receipts/processReceipt'

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

const RECENT_COUNT = 10

// The last uploads for the employee screen, so an employee sees that the
// photo arrived and does not upload the same paper twice. Public, like POST.
// The photo links expire after 10 minutes.
export async function GET() {
  try {
    const rows = await listRecentReceipts(RECENT_COUNT)
    const client = s3Client()
    const Bucket = s3Bucket()
    const receipts = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        uploadedAt: r.uploaded_at,
        uploaderName: r.employees?.name ?? null,
        imageUrl: await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: r.s3_key }), { expiresIn: 600 }),
      })),
    )
    return NextResponse.json({ receipts })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
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
//   fileName    the original file name, for the admin page
//   employeeId  optional
//
// The duplicate key is the SHA-256 of the JPEG we store, computed here. iOS
// hands the browser different original bytes each time one library photo is
// picked, but the browser's downscale of it comes out byte-identical.
export async function POST(req) {
  const form = await req.formData().catch(() => null)
  if (!form) return badRequest('Expected multipart/form-data')

  const photo = form.get('photo')
  if (!(photo instanceof Blob)) return badRequest('photo is required')
  if (photo.size > MAX_RECEIPT_BYTES) return badRequest('photo is too large')

  const bytes = new Uint8Array(await photo.arrayBuffer())
  if (!isJpeg(bytes)) return badRequest('photo must be a JPEG')
  const sha256 = createHash('sha256').update(bytes).digest('hex')

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
    const { id, created } = await createReceipt({
      s3Key: key,
      fileName: name || 'receipt.jpg',
      sha256,
      uploadedBy: await resolveUploader(form.get('employeeId')),
    })
    // Read the photo with Claude once the employee has the answer. If the
    // host stops this early, the row stays pending for the admin page sweep.
    if (created) after(() => processReceipt(id))
    return NextResponse.json({ id })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
