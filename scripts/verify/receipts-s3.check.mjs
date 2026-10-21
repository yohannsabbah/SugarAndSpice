// Proves the S3 credentials can write and read under receipts/, and that a
// presigned PUT enforces its signed ContentLength.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-s3.check.mjs
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, s3Bucket } from '@/lib/s3'

const client = s3Client()
const Bucket = s3Bucket()
const stamp = Date.now()
const directKey = `receipts/00_0000/verify-${stamp}.txt`
const presignKey = `receipts/00_0000/verify-${stamp}-presigned.jpg`

function fail(step, reason) {
  console.error(`FAIL ${step}: ${reason}`)
  process.exit(1)
}

try {
  await client.send(new PutObjectCommand({ Bucket, Key: directKey, Body: 'ok' }))
} catch (e) {
  fail('1 direct put', `${e.name}: ${e.message}`)
}

try {
  const head = await client.send(new HeadObjectCommand({ Bucket, Key: directKey }))
  if (head.ContentLength !== 2) fail('2 head', `ContentLength ${head.ContentLength}, expected 2`)
} catch (e) {
  fail('2 head', `${e.name}: ${e.message}`)
}

const presign = () =>
  getSignedUrl(
    client,
    new PutObjectCommand({ Bucket, Key: presignKey, ContentType: 'image/jpeg', ContentLength: 3 }),
    { expiresIn: 60 },
  )

{
  const res = await fetch(await presign(), {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: 'abc',
  })
  if (!res.ok) fail('3 presigned put', `HTTP ${res.status} ${await res.text()}`)
}

{
  const res = await fetch(await presign(), {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: 'abcd',
  })
  if (res.ok) fail('4 size cap', 'a 4-byte body was accepted by a URL signed for 3 bytes')
}

for (const Key of [directKey, presignKey]) {
  try {
    await client.send(new DeleteObjectCommand({ Bucket, Key }))
  } catch (e) {
    if (e.name === 'AccessDenied') {
      console.warn('WARN: no DeleteObject permission — remove receipts/00_0000/ by hand')
      break
    }
    fail('5 delete', `${e.name}: ${e.message}`)
  }
}

console.log('PASS')
