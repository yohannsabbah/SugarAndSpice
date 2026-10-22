// Receipt S3 keys and upload checks for the receipts route.
// Kept free of server-only imports so plain Node verify scripts can load it.

// The photo travels through our server function, and Amplify caps the request
// body near 6 MB. A downscaled receipt photo is about 300 KB.
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024

const SHA256_RE = /^[0-9a-f]{64}$/

// The folder month is the upload month in Israel. The server runs in UTC,
// so a photo taken just after midnight on the 1st would otherwise land in
// the previous month's folder.
const ISRAEL_MONTH = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
})

export function receiptS3Key(now, sha256) {
  const parts = Object.fromEntries(ISRAEL_MONTH.formatToParts(now).map((p) => [p.type, p.value]))
  return `receipts/${parts.month}_${parts.year}/${now.getTime()}-${sha256.slice(0, 8)}.jpg`
}

export function isSha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value)
}

// The route is public, so check the bytes rather than trust the declared type.
export function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}
