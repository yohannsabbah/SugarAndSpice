import { findWoltPeriodByInvoiceNo, findWoltPeriodId } from '../../src/lib/db/wolt.js'

let failed = 0
function check(label, actual, expected) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

const byMerchantInvoice = await findWoltPeriodByInvoiceNo({ merchantInvoiceNo: '660009' })
check('found by merchant invoice no', byMerchantInvoice?.period_num, 9)

const byWoltInvoice = await findWoltPeriodByInvoiceNo({ woltInvoiceNo: '4958141' })
check('found by wolt invoice no', byWoltInvoice?.period_num, 9)

const notFound = await findWoltPeriodByInvoiceNo({ merchantInvoiceNo: 'does-not-exist' })
check('not found returns null', notFound, null)

const id9 = await findWoltPeriodId(2026, 9)
check('findWoltPeriodId returns a truthy id for period 9', !!id9, true)

const idMissing = await findWoltPeriodId(2026, 99)
check('findWoltPeriodId returns null for a period that does not exist', idMissing, null)

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS — all wolt-lookup checks')
