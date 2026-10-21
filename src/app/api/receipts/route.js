import { NextResponse } from 'next/server'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3Bucket, s3Client } from '@/lib/s3'
import { isReceiptKey, isSha256, keyMatchesHash } from '@/lib/receipts/keys'
import { createReceipt } from '@/lib/db/receipts'
import { getEmployee } from '@/lib/db/employees'

export const dynamic = 'force-dynamic'

// The uploader is recorded when known, but never blocks the upload: the
// employee may not have picked a name yet, or the stored id may be stale.
async function resolveUploader(employeeId) {
  if (!employeeId) return null
  try {
    const employee = await getEmployee(employeeId)
    return employee ? employee.id : null
  } catch {
    return null // e.g. not a uuid (Postgres 22P02)
  }
}

// Records a finished browser upload. Public, like /api/shifts/*.
export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  const { key, sha256, fileName, employeeId } = body
  if (!isReceiptKey(key) || !isSha256(sha256) || !keyMatchesHash(key, sha256)) {
    return NextResponse.json({ error: 'Invalid key or sha256' }, { status: 400 })
  }

  // Never record a receipt that is not actually in S3: the employee throws
  // the paper away once they see "Done".
  try {
    await s3Client().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }))
  } catch (e) {
    if (e.name === 'NotFound') {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }

  try {
    const name = typeof fileName === 'string' ? fileName.trim().slice(0, 200) : ''
    const { id } = await createReceipt({
      s3Key: key,
      fileName: name || 'receipt.jpg',
      sha256,
      uploadedBy: await resolveUploader(employeeId),
    })
    return NextResponse.json({ id })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
