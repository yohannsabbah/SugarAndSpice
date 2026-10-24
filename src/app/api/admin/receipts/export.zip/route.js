import { ZipArchive } from 'archiver'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { isAdmin } from '@/lib/admin'
import { listReceiptsForMonth } from '@/lib/db/receipts'
import { receiptsCsv, zipEntryName } from '@/lib/receipts/exportFormat'
import { s3Bucket, s3Client } from '@/lib/s3'

export const dynamic = 'force-dynamic'

const PARALLEL_DOWNLOADS = 5

async function readPhotos(client, Bucket, rows) {
  const photos = []
  for (let i = 0; i < rows.length; i += PARALLEL_DOWNLOADS) {
    const batch = rows.slice(i, i + PARALLEL_DOWNLOADS)
    photos.push(
      ...(await Promise.all(
        batch.map(async (r) => {
          const o = await client.send(new GetObjectCommand({ Bucket, Key: r.s3_key }))
          return { name: zipEntryName(r), bytes: Buffer.from(await o.Body.transformToByteArray()) }
        }),
      )),
    )
  }
  return photos
}

function buildZip(files) {
  // JPEGs are already compressed; level 1 keeps the build fast.
  const archive = new ZipArchive({ zlib: { level: 1 } })
  const chunks = []
  const done = new Promise((resolve, reject) => {
    archive.on('data', (c) => chunks.push(c))
    archive.on('end', resolve)
    archive.on('error', reject)
    archive.on('warning', reject)
  })
  for (const f of files) archive.append(f.bytes, { name: f.name })
  archive.finalize()
  return done.then(() => Buffer.concat(chunks))
}

// GET /api/admin/receipts/export.zip?month=YYYY-MM — every photo of the month
// plus receipts.csv. A month of photos can exceed what a server function may
// return, so the ZIP goes to S3 and the browser downloads it from there.
export async function GET(req) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const month = new URL(req.url).searchParams.get('month')
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    return Response.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  try {
    const client = s3Client()
    const Bucket = s3Bucket()
    const rows = await listReceiptsForMonth(month)
    const photos = await readPhotos(client, Bucket, rows.filter((r) => !r.duplicate_of))
    const zip = await buildZip([...photos, { name: 'receipts.csv', bytes: Buffer.from(receiptsCsv(rows)) }])

    const Key = `receipts/exports/receipts-${month}-${Date.now()}.zip`
    await client.send(new PutObjectCommand({ Bucket, Key, Body: zip, ContentType: 'application/zip' }))
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket,
        Key,
        ResponseContentDisposition: `attachment; filename="receipts-${month}.zip"`,
      }),
      { expiresIn: 300 },
    )
    return Response.redirect(url, 303)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
