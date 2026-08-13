import { classifyParsedPdf, classifyCsv } from '../../src/lib/parsers/wolt/classify.js'

let failed = 0
function check(label, actual, expected) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

// -- classifyParsedPdf --------------------------------------------------
const empty = { netting: {}, sales: { orders: [] }, m2w: {}, w2m: { fees: [] } }

check(
  'netting wins on nettingNo',
  classifyParsedPdf({ ...empty, netting: { nettingNo: '123' } }).type,
  'netting'
)
check(
  'sales_report wins on order rows',
  classifyParsedPdf({ ...empty, sales: { orders: [{ placed_at: '2026-05-01T00:00:00' }] } }).type,
  'sales_report'
)
check(
  'm2w wins on grossSalesInclVat',
  classifyParsedPdf({ ...empty, m2w: { grossSalesInclVat: 1000 } }).type,
  'm2w'
)
check(
  'w2m wins on fee lines',
  classifyParsedPdf({ ...empty, w2m: { fees: [{ fee_category: 'commission_pickup' }] } }).type,
  'w2m'
)
check(
  'w2m wins on totalInclVat when no fee lines',
  classifyParsedPdf({ ...empty, w2m: { fees: [], totalInclVat: 42 } }).type,
  'w2m'
)
check(
  'unrecognized shape -> unknown',
  classifyParsedPdf(empty).type,
  'unknown'
)
check(
  'netting checked before sales_report/m2w/w2m (specificity order)',
  classifyParsedPdf({
    netting: { nettingNo: '999' },
    sales: { orders: [{ placed_at: '2026-05-01T00:00:00' }] },
    m2w: { grossSalesInclVat: 1000 },
    w2m: { fees: [{ fee_category: 'commission_pickup' }] },
  }).type,
  'netting'
)

// -- classifyCsv ----------------------------------------------------------
const itemsHeader = 'Merchant SKU,Item name,Quantity,Total\n001,Iced Latte,5,150'
const purchasesHeader = 'Order number,Order placed,Delivery type,Price\n123,01/05/2026, 10:00,Wolt delivery,45'
const junkHeader = 'foo,bar,baz\n1,2,3'

check('items CSV detected', classifyCsv(itemsHeader), 'csv_items')
check('purchases CSV detected', classifyCsv(purchasesHeader), 'csv_purchases')
check('unrecognized CSV -> unknown', classifyCsv(junkHeader), 'unknown')

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS — all classify checks')
