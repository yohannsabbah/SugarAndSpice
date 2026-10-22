// Hits POST /api/receipts on a running dev server (npm run dev).
// The validation cases need nothing else. The last two cases need the
// receipts table and S3, and leave one row + one object behind to delete.
//
// Usage: node scripts/verify/receipts-route.check.mjs [baseUrl]
import { createHash } from 'node:crypto'

const BASE = process.argv[2] || 'http://localhost:3000'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`verify ${Date.now()}`)])
const SHA = createHash('sha256').update(JPEG).digest('hex')

function form(fields) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v)
  return fd
}

async function post(fields) {
  const r = await fetch(`${BASE}/api/receipts`, { method: 'POST', body: form(fields) })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const photo = (bytes = JPEG) => new Blob([bytes], { type: 'image/jpeg' })

const cases = [
  ['no photo', { sha256: SHA }, 400, /photo/],
  ['bad sha256', { photo: photo(), sha256: 'nothex' }, 400, /sha256/],
  ['not a JPEG', { photo: new Blob(['hello'], { type: 'image/jpeg' }), sha256: SHA }, 400, /JPEG/],
  ['too large', { photo: photo(Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)])), sha256: SHA }, 400, /large/],
]

let failed = 0
for (const [name, fields, status, errRe] of cases) {
  const r = await post(fields)
  if (r.status !== status || !errRe.test(r.body?.error || '')) {
    failed++
    console.error(`FAIL ${name}: expected ${status} ${errRe}, got ${r.status} ${JSON.stringify(r.body)}`)
  }
}

if (process.env.RECEIPTS_DB !== 'skip') {
  const first = await post({ photo: photo(), sha256: SHA, fileName: 'verify.jpg', employeeId: 'not-a-uuid' })
  if (first.status !== 200 || typeof first.body?.id !== 'string') {
    failed++
    console.error(`FAIL first upload: ${first.status} ${JSON.stringify(first.body)}`)
  }
  const again = await post({ photo: photo(), sha256: SHA, fileName: 'verify.jpg' })
  if (again.status !== 200 || again.body?.id !== first.body?.id) {
    failed++
    console.error(`FAIL duplicate returns the same id: ${again.status} ${JSON.stringify(again.body)}`)
  }
  if (first.body?.id) console.log(`created receipt ${first.body.id} (sha ${SHA}) — delete it after the check`)
}

if (failed) {
  console.error(`${failed} case(s) failed`)
  process.exit(1)
}
console.log('PASS')
