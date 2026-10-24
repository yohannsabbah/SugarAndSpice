// The accountant's handoff: one CSV row per receipt, and a matching file name
// for each photo in the ZIP. Duplicates are left out of both. Pure.

import { netAmount } from './money.js'

const CSV_HEADER = [
  'date',
  'time',
  'vendor',
  'receipt_number',
  'amount',
  'vat_rate',
  'vat_amount',
  'net_amount',
  'uploaded_by',
  'image_file',
]

const ISRAEL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function money(n) {
  return n === null || n === undefined ? '' : Number(n).toFixed(2)
}

function fileSafe(text) {
  return (text || '').replace(/[\s/\\:*?"<>|,]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

// Hebrew stays as-is: the accountant reads these names.
export function zipEntryName(row) {
  const date = row.purchased_at || ISRAEL_DATE.format(new Date(row.uploaded_at))
  const vendor = fileSafe(row.vendor) || 'unknown'
  const amount = row.total === null || row.total === undefined ? 'no-amount' : money(row.total)
  return `${date}_${vendor}_${amount}_${row.id.slice(0, 8)}.jpg`
}

function cell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// The BOM makes Excel read the file as UTF-8, so Hebrew vendor names survive.
export function receiptsCsv(rows) {
  const lines = [CSV_HEADER.join(',')]
  for (const r of rows) {
    if (r.duplicate_of) continue
    lines.push(
      [
        r.purchased_at,
        r.purchased_time,
        r.vendor,
        r.receipt_number,
        money(r.total),
        r.vat_rate === null || r.vat_rate === undefined ? '' : String(Number(r.vat_rate)),
        money(r.vat_amount),
        money(netAmount(r.total, r.vat_amount)),
        r.employees?.name ?? '',
        zipEntryName(r),
      ]
        .map(cell)
        .join(','),
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
