// Receipt S3 keys and hash checks, shared by the upload routes.
// Kept free of server-only imports so plain Node verify scripts can load it.

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

const SHA256_RE = /^[0-9a-f]{64}$/
const KEY_RE = /^receipts\/\d{2}_\d{4}\/\d+-[0-9a-f]{8}\.jpg$/

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

export function isReceiptKey(value) {
  return typeof value === 'string' && KEY_RE.test(value)
}

export function keyMatchesHash(key, sha256) {
  return key.slice(-12, -4) === sha256.slice(0, 8)
}
