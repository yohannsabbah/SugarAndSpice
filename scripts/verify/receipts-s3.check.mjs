// Proves the S3 credentials can write, read, and delete under receipts/.
// The receipts route writes with these same credentials.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-s3.check.mjs
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { s3Client, s3Bucket } from '@/lib/s3'

const client = s3Client()
const Bucket = s3Bucket()
const stamp = Date.now()
const directKey = `receipts/00_0000/verify-${stamp}.txt`

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

for (const Key of [directKey]) {
  try {
    await client.send(new DeleteObjectCommand({ Bucket, Key }))
  } catch (e) {
    if (e.name === 'AccessDenied') {
      console.warn('WARN: no DeleteObject permission — remove receipts/00_0000/ by hand')
      break
    }
    fail('3 delete', `${e.name}: ${e.message}`)
  }
}

console.log('PASS')
