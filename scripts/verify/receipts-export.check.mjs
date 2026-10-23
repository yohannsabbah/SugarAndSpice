import { zipEntryName, receiptsCsv } from '../../src/lib/receipts/exportFormat.js'

const HEADER = 'date,time,vendor,receipt_number,amount,vat_rate,vat_amount,net_amount,uploaded_by,image_file'
const r = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  purchased_at: '2026-10-03',
  purchased_time: '09:15:00',
  vendor: 'רמי לוי',
  receipt_number: '77',
  total: 147.5,
  vat_rate: 0.18,
  vat_amount: 22.5,
  employees: { name: 'Anastasia' },
  uploaded_at: '2026-10-03T07:00:00Z',
}

const cases = [
  ['zip name', zipEntryName(r), '2026-10-03_רמי-לוי_147.50_a1b2c3d4.jpg'],
  ['zip name, nothing read, uploaded 1 Nov Israel', zipEntryName({ ...r, vendor: null, total: null, purchased_at: null, uploaded_at: '2026-10-31T22:30:00Z' }), '2026-11-01_unknown_no-amount_a1b2c3d4.jpg'],
  ['empty month is header only', receiptsCsv([]), `﻿${HEADER}\r\n`],
  ['quoting', receiptsCsv([{ ...r, vendor: 'Cafe "Joe", Haifa' }]).split('\r\n')[1], '2026-10-03,09:15:00,"Cafe ""Joe"", Haifa",77,147.50,0.18,22.50,125.00,Anastasia,2026-10-03_Cafe-Joe-Haifa_147.50_a1b2c3d4.jpg'],
  ['duplicates are left out', receiptsCsv([r, { ...r, id: 'b', duplicate_of: r.id }]).split('\r\n').length, 3],
]

let failed = 0
for (const [name, actual, expected] of cases) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
