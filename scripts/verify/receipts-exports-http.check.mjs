// Downloads the CSV and ZIP exports from a running dev server and checks them
// against the database. Read-only except for the ZIP files the route writes
// under receipts/exports/ in S3.
//
// Usage: node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-exports-http.check.mjs [baseUrl]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listReceiptsForMonth } from '@/lib/db/receipts'
import { zipEntryName } from '@/lib/receipts/exportFormat'

const BASE = process.argv[2] || 'http://localhost:3000'
const COOKIE = `ss_admin=${createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')}`
const HEADER = 'date,time,vendor,receipt_number,amount,vat_rate,vat_amount,net_amount,uploaded_by,image_file'
const dir = mkdtempSync(join(tmpdir(), 'receipts-export-'))

let failed = 0
function check(name, ok, detail = '') {
  if (!ok) {
    failed++
    console.error(`FAIL ${name} ${detail}`)
  }
}

async function get(path, auth = true) {
  return fetch(BASE + path, { headers: auth ? { Cookie: COOKIE } : {} })
}

for (const [month, expectRows] of [['2026-10', true], ['2026-01', false]]) {
  const expected = (await listReceiptsForMonth(month)).filter((r) => !r.duplicate_of)

  const csvRes = await get(`/api/admin/receipts/export.csv?month=${month}`)
  check(`${month} csv status`, csvRes.status === 200, String(csvRes.status))
  const bytes = Buffer.from(await csvRes.arrayBuffer())
  check(`${month} csv BOM`, bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  const lines = bytes.toString('utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean)
  check(`${month} csv header`, lines[0] === HEADER, lines[0])
  check(`${month} csv row count`, lines.length - 1 === expected.length, `${lines.length - 1} vs ${expected.length}`)
  check(`${month} has rows as expected`, (expected.length > 0) === expectRows, `${expected.length}`)

  const zipRes = await get(`/api/admin/receipts/export.zip?month=${month}`)
  check(`${month} zip status`, zipRes.status === 200, String(zipRes.status))
  const zipPath = join(dir, `${month}.zip`)
  writeFileSync(zipPath, Buffer.from(await zipRes.arrayBuffer()))
  let names = []
  try {
    // Python's zipfile honors the UTF-8 name flag. macOS unzip prints Hebrew names as "?".
    const list = 'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))'
    names = execFileSync('python3', ['-I', '-c', list, zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
  } catch (e) {
    check(`${month} zip readable`, false, e.message.split('\n')[0])
  }
  const want = ['receipts.csv', ...expected.map(zipEntryName)].sort()
  check(`${month} zip entries`, JSON.stringify(names) === JSON.stringify(want), JSON.stringify({ names, want }))
}

check('csv needs admin', (await get('/api/admin/receipts/export.csv?month=2026-10', false)).status === 401)
check('zip needs admin', (await get('/api/admin/receipts/export.zip?month=2026-10', false)).status === 401)
check('bad month → 400', (await get('/api/admin/receipts/export.csv?month=oct')).status === 400)

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS')
