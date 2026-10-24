import 'server-only'
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { s3Bucket, s3Client } from '@/lib/s3'

// receipts/10_2026/x.jpg → receipts/deleted/10_2026/x.jpg
export function deletedKey(key) {
  return key.replace(/^receipts\//, 'receipts/deleted/')
}

// Copies the photo into receipts/deleted/ before the row goes, so a mistaken
// delete stays recoverable. Returns false when the photo is already missing.
export async function copyToDeleted(key) {
  try {
    await s3Client().send(
      new CopyObjectCommand({ Bucket: s3Bucket(), CopySource: `${s3Bucket()}/${encodeURI(key)}`, Key: deletedKey(key) }),
    )
    return true
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return false
    throw e
  }
}

// Removes the original after the row is gone. A failure here leaves only a
// stray copy in the month folder, never a lost photo.
export async function removeOriginal(key) {
  await s3Client().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key })).catch(() => {})
}
