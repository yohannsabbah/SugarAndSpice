# Wolt Upload UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-run `scripts/backfill-wolt.mjs` as the only way to get Wolt data into Supabase with a self-serve multi-file upload on the Wolt admin page, matching the design in `docs/superpowers/specs/2026-08-13-wolt-upload-ui-design.md`.

**Architecture:** One dropzone accepts any mix of the 6 Wolt file types (4 PDFs + 2 CSVs), any order, any time. A classifier identifies each file by content (not filename), an API route processes files in a fixed priority order (period-establishing docs before period-dependent ones) and writes straight to the existing `wolt_*` Supabase tables via the already-existing `src/lib/db/wolt.js` write functions — no raw file storage.

**Tech Stack:** Next.js 16 App Router (route handler + client component), `papaparse` (CSV), `pdf-parse` via the existing `pdfText()` helper, Supabase JS client. No test framework exists in this repo — pure-logic checks are plain Node ESM scripts under `scripts/verify/`; anything touching Supabase or the HTTP route is verified manually against the running dev server and the real dev Supabase project (already seeded with periods 7–10 from the historical backfill).

## Global Constraints

- No raw uploaded file is ever persisted (no `documents` table writes from this path) — only extracted data.
- Classification is content-based, not filename-based, **except** the monthly items CSV, which has no per-row date and must get its month from the filename pattern `items_YYYY-MM-DD_...` (this exception is explicit in the design spec).
- `scripts/backfill-wolt.mjs` is not modified by this plan — it already has its own working, separate write logic and is out of scope.
- All new Supabase writes go through `src/lib/db/wolt.js` (existing file) — do not inline `supabase.from(...)` calls in the API route.
- Every route response lists a per-file result (`{ filename, detected_type, status, detail }`) — never a single pass/fail for the whole batch.

---

## File Structure

**Create:**
- `src/lib/parsers/wolt/period.js` — pure period-math helper (`periodNumForDate`).
- `src/lib/parsers/wolt/classify.js` — file classification (PDF signature detection + CSV header detection).
- `src/app/api/admin/wolt/upload/route.js` — the upload endpoint.
- `src/app/admin/(dashboard)/wolt/UploadCard.js` — the dropzone UI.
- `scripts/verify/period.check.mjs` — throwaway-but-kept regression check for `periodNumForDate`.
- `scripts/verify/classify.check.mjs` — regression check for `classifyParsedPdf` / `classifyCsv` using fabricated fixtures (no real PDF files needed).

**Modify:**
- `src/lib/db/wolt.js` — add `findWoltPeriodByInvoiceNo` and `findWoltPeriodId` read helpers.
- `src/app/admin/(dashboard)/wolt/page.js` — render `<UploadCard />`; update the empty-state copy.

**No changes to `scripts/backfill-wolt.mjs` or any SQL schema** — no new tables/columns are needed, everything targets existing `wolt_periods` / `wolt_period_fees` / `wolt_deductions` / `wolt_orders` / `wolt_order_items` / `wolt_period_items` columns already used by the backfill script.

---

### Task 1: Period math helper

**Files:**
- Create: `src/lib/parsers/wolt/period.js`
- Create: `scripts/verify/period.check.mjs`

**Interfaces:**
- Produces: `periodNumForDate(isoDate: string) -> { year: number, num: number }` — used by Task 4 (route) to turn a parsed date into a `wolt_periods` key. `isoDate` is any string starting with `YYYY-MM-DD` (e.g. a full ISO timestamp is fine — only the first 10 chars are used).

- [ ] **Step 1: Write the check script (fails — module doesn't exist yet)**

Create `scripts/verify/period.check.mjs`:

```js
import { periodNumForDate } from '../../src/lib/parsers/wolt/period.js'

const cases = [
  ['2026-04-01', { year: 2026, num: 7 }],
  ['2026-04-15', { year: 2026, num: 7 }],
  ['2026-04-16', { year: 2026, num: 8 }],
  ['2026-04-30', { year: 2026, num: 8 }],
  ['2026-05-01T09:30:00', { year: 2026, num: 9 }],
  ['2026-12-16', { year: 2026, num: 24 }],
  ['2026-01-01', { year: 2026, num: 1 }],
]

let failed = 0
for (const [input, expected] of cases) {
  const actual = periodNumForDate(input)
  const ok = actual.year === expected.year && actual.num === expected.num
  if (!ok) {
    failed++
    console.error(`FAIL ${input}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
if (failed) {
  console.error(`${failed}/${cases.length} cases failed`)
  process.exit(1)
}
console.log(`PASS — all ${cases.length} cases`)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/period.check.mjs`
Expected: fails with a module-not-found error (`period.js` doesn't exist yet).

- [ ] **Step 3: Implement `periodNumForDate`**

Create `src/lib/parsers/wolt/period.js`:

```js
// Wolt bills in fixed half-month periods: 1st–15th and 16th–end of each
// month, numbered 1..24 per year (period 1 = Jan 1-15, period 2 = Jan
// 16-31, ... period 24 = Dec 16-31).
export function periodNumForDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return { year: y, num: (m - 1) * 2 + (d <= 15 ? 1 : 2) }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify/period.check.mjs`
Expected: `PASS — all 7 cases`

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/wolt/period.js scripts/verify/period.check.mjs
git commit -m "Add periodNumForDate helper for Wolt period math"
```

---

### Task 2: File classifier

**Files:**
- Create: `src/lib/parsers/wolt/classify.js`
- Create: `scripts/verify/classify.check.mjs`

**Interfaces:**
- Consumes: `parseWoltToMerchant`, `parseMerchantToWolt`, `parseNetting`, `parseSalesReport` from `src/lib/parsers/wolt/index.js` (all `(buffer) => Promise<object>`, already implemented and unchanged).
- Produces:
  - `classifyParsedPdf({ netting, sales, m2w, w2m }) -> { type: 'netting'|'sales_report'|'m2w'|'w2m'|'unknown', parsed: object|null }` — pure decision function, no I/O. Takes the four parsers' already-computed outputs (this split exists specifically so the decision logic is unit-testable without needing real Wolt PDF files).
  - `classifyPdf(buffer: Buffer) -> Promise<{ type, parsed }>` — runs all 4 parsers against `buffer` (via `Promise.all`) and delegates to `classifyParsedPdf`. Used by Task 4.
  - `classifyCsv(csvText: string) -> 'csv_items'|'csv_purchases'|'unknown'` — reads only the header row. Used by Task 4.

- [ ] **Step 1: Write the check script (fails — module doesn't exist yet)**

Create `scripts/verify/classify.check.mjs`. This fabricates minimal parser-output shapes and CSV headers — it does **not** need real Wolt PDF files, because `classifyParsedPdf` operates on already-parsed objects:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/classify.check.mjs`
Expected: fails with a module-not-found error (`classify.js` doesn't exist yet).

- [ ] **Step 3: Implement the classifier**

Create `src/lib/parsers/wolt/classify.js`:

```js
import {
  parseWoltToMerchant,
  parseMerchantToWolt,
  parseNetting,
  parseSalesReport,
} from './index.js'
import Papa from 'papaparse'

// Pure decision logic — given the four PDF parsers' already-computed
// outputs, decide which one this file actually is. Order matters: netting
// and sales-report signals are the most specific and are checked first to
// avoid false positives against the two invoice types, which share a
// similar header structure (invoice date / invoice no / period line).
export function classifyParsedPdf({ netting, sales, m2w, w2m }) {
  if (netting.nettingNo) return { type: 'netting', parsed: netting }
  if (sales.orders.length > 0) return { type: 'sales_report', parsed: sales }
  if (m2w.grossSalesInclVat != null) return { type: 'm2w', parsed: m2w }
  if (w2m.fees.length > 0 || w2m.totalInclVat != null) return { type: 'w2m', parsed: w2m }
  return { type: 'unknown', parsed: null }
}

export async function classifyPdf(buffer) {
  const [netting, sales, m2w, w2m] = await Promise.all([
    parseNetting(buffer),
    parseSalesReport(buffer),
    parseMerchantToWolt(buffer),
    parseWoltToMerchant(buffer),
  ])
  return classifyParsedPdf({ netting, sales, m2w, w2m })
}

export function classifyCsv(csvText) {
  const { meta } = Papa.parse(csvText, { header: true, preview: 1 })
  const cols = meta.fields || []
  const has = (name) => cols.includes(name)
  if (has('Item name') && has('Quantity') && has('Total')) return 'csv_items'
  if (has('Order placed') && has('Order number')) return 'csv_purchases'
  return 'unknown'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify/classify.check.mjs`
Expected: `PASS — all classify checks`

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/wolt/classify.js scripts/verify/classify.check.mjs
git commit -m "Add content-based classifier for Wolt PDF/CSV uploads"
```

---

### Task 3: Period-lookup DB helpers

**Files:**
- Modify: `src/lib/db/wolt.js` (add two functions near `upsertWoltPeriod`, after line 90)

**Interfaces:**
- Produces:
  - `findWoltPeriodByInvoiceNo({ woltInvoiceNo, merchantInvoiceNo }) -> Promise<{ id, period_year, period_num } | null>` — used by Task 4's `netting` handler.
  - `findWoltPeriodId(periodYear: number, periodNum: number) -> Promise<string | null>` — used by Task 4's `csv_purchases` handler.

- [ ] **Step 1: Write the check script (fails — functions don't exist yet)**

This one needs the real dev Supabase project (already seeded with periods 7–10 from the historical backfill — period 9 has `merchant_invoice_no: '660009'`, `wolt_invoice_no: '4958141'`, `period_year: 2026`, `period_num: 9`). Create `scripts/verify/wolt-lookup.check.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --env-file=.env.local scripts/verify/wolt-lookup.check.mjs`
Expected: fails — `findWoltPeriodByInvoiceNo is not a function` (or similar import error).

- [ ] **Step 3: Implement the two helpers**

In `src/lib/db/wolt.js`, add directly after the closing brace of `upsertWoltPeriod` (after line 90, before the `mergeNonNull` helper):

```js
// ─────────────────────────────────────────────────────────────────────────────
// wolt_periods — lookups used by the upload route to place documents that
// don't carry their own dates (netting, purchases CSV grouping).
// ─────────────────────────────────────────────────────────────────────────────
export async function findWoltPeriodByInvoiceNo({ woltInvoiceNo, merchantInvoiceNo }) {
  if (!woltInvoiceNo && !merchantInvoiceNo) return null
  const clauses = []
  if (woltInvoiceNo) clauses.push(`wolt_invoice_no.eq.${woltInvoiceNo}`)
  if (merchantInvoiceNo) clauses.push(`merchant_invoice_no.eq.${merchantInvoiceNo}`)
  const { data, error } = await supabase
    .from('wolt_periods')
    .select('id, period_year, period_num')
    .or(clauses.join(','))
    .maybeSingle()
  if (error) throw error
  return data
}

export async function findWoltPeriodId(periodYear, periodNum) {
  const { data, error } = await supabase
    .from('wolt_periods')
    .select('id')
    .eq('period_year', periodYear)
    .eq('period_num', periodNum)
    .maybeSingle()
  if (error) throw error
  return data?.id || null
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --env-file=.env.local scripts/verify/wolt-lookup.check.mjs`
Expected: `PASS — all wolt-lookup checks`

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/wolt.js scripts/verify/wolt-lookup.check.mjs
git commit -m "Add period-lookup helpers to db/wolt for the upload route"
```

---

### Task 4: Upload API route

**Files:**
- Create: `src/app/api/admin/wolt/upload/route.js`

**Interfaces:**
- Consumes:
  - `isAdmin()` from `@/lib/admin` — `() => Promise<boolean>`.
  - `classifyPdf`, `classifyCsv` from `@/lib/parsers/wolt/classify` (Task 2).
  - `periodNumForDate` from `@/lib/parsers/wolt/period` (Task 1).
  - `parseCsvItems(csvText, { monthStart }) -> Array<{month_start, merchant_sku, item_name, units_sold, revenue_incl_vat}>` and `parseCsvPurchases(csvText) -> Array<{order_no_public, placed_at, delivered_at, status, channel, price_incl_vat, review_score, review_comment, review_attributions, items}>` from `@/lib/parsers/wolt`.
  - `upsertWoltPeriod`, `replaceWoltPeriodFees`, `replaceWoltDeductions`, `replaceWoltPeriodItems`, `replaceWoltOrders`, `insertWoltOrderItems` (existing, unchanged) and `findWoltPeriodByInvoiceNo`, `findWoltPeriodId` (Task 3) from `@/lib/db/wolt`.
- Produces: `POST` handler at `/api/admin/wolt/upload` accepting `multipart/form-data` with repeated `files` fields, returning `{ results: [{ filename, detected_type, status: 'ok'|'error', detail }] }`. Consumed by Task 5's `UploadCard`.

- [ ] **Step 1: Create the route file**

Create `src/app/api/admin/wolt/upload/route.js`:

```js
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { classifyPdf, classifyCsv } from '@/lib/parsers/wolt/classify'
import { periodNumForDate } from '@/lib/parsers/wolt/period'
import { parseCsvItems, parseCsvPurchases } from '@/lib/parsers/wolt'
import {
  upsertWoltPeriod,
  replaceWoltPeriodFees,
  replaceWoltDeductions,
  replaceWoltPeriodItems,
  replaceWoltOrders,
  insertWoltOrderItems,
  findWoltPeriodByInvoiceNo,
  findWoltPeriodId,
} from '@/lib/db/wolt'

const PDF_MAGIC = '%PDF-'
// Period-establishing docs first (they can create a wolt_periods row from
// their own content), period-dependent docs last (they need that row to
// already exist, either from earlier in this same batch or from a prior
// upload).
const PRIORITY = { w2m: 0, m2w: 1, sales_report: 2, csv_items: 3, netting: 4, csv_purchases: 5, unknown: 6 }

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const files = form.getAll('files')
  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const classified = []
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const isPdf = buffer.subarray(0, 5).toString('latin1') === PDF_MAGIC
    if (isPdf) {
      const { type, parsed } = await classifyPdf(buffer)
      classified.push({ filename: file.name, type, parsed })
    } else {
      const text = buffer.toString('utf8')
      const type = classifyCsv(text)
      classified.push({ filename: file.name, type, text })
    }
  }

  classified.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])

  const results = []
  for (const file of classified) {
    try {
      const detail = await processFile(file)
      results.push({ filename: file.filename, detected_type: file.type, status: 'ok', detail })
    } catch (e) {
      results.push({ filename: file.filename, detected_type: file.type, status: 'error', detail: e.message })
    }
  }

  return NextResponse.json({ results })
}

async function processFile(file) {
  switch (file.type) {
    case 'w2m': return processW2m(file.parsed)
    case 'm2w': return processM2w(file.parsed)
    case 'sales_report': return processSalesReport(file.parsed)
    case 'netting': return processNetting(file.parsed)
    case 'csv_items': return processCsvItems(file.filename, file.text)
    case 'csv_purchases': return processCsvPurchases(file.text)
    default: throw new Error('Unrecognized file — not a known Wolt PDF or CSV')
  }
}

async function processW2m(w2m) {
  if (!w2m.periodStart) throw new Error('Could not read the billing period from this invoice')
  const { year, num } = periodNumForDate(w2m.periodStart)
  const periodId = await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    period_start: w2m.periodStart,
    period_end: w2m.periodEnd,
    invoice_date: w2m.invoiceDate,
    wolt_invoice_no: w2m.invoiceNo,
    wolt_fees_excl_vat: w2m.totalExclVat,
    wolt_fees_vat: w2m.totalVat,
    wolt_fees_incl_vat: w2m.totalInclVat,
  })
  await replaceWoltPeriodFees(periodId, w2m.fees.map((f) => ({
    fee_category: f.fee_category,
    description: f.description,
    units: f.units ?? null,
    base_amount: f.base ?? f.base_amount ?? null,
    amount_excl_vat: f.amount_excl_vat,
    vat_amount: f.vat_amount,
    amount_incl_vat: f.amount_incl_vat,
    campaign_id: f.campaign_id || null,
    campaign_start: f.campaign_start || null,
    campaign_end: f.campaign_end || null,
  })))
  return `Period ${year}-P${num} updated (${w2m.fees.length} fee lines)`
}

async function processM2w(m2w) {
  if (!m2w.periodStart) throw new Error('Could not read the billing period from this invoice')
  const { year, num } = periodNumForDate(m2w.periodStart)
  await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    period_start: m2w.periodStart,
    period_end: m2w.periodEnd,
    invoice_date: m2w.invoiceDate,
    merchant_invoice_no: m2w.invoiceNo,
    gross_sales_excl_vat: m2w.grossSalesExclVat,
    gross_sales_vat: m2w.grossSalesVat,
    gross_sales_incl_vat: m2w.grossSalesInclVat,
    refunds_incl_vat: m2w.refundsInclVat,
  })
  return `Period ${year}-P${num} updated (gross sales ${m2w.grossSalesInclVat})`
}

async function processSalesReport(sales) {
  if (!sales.orders.length) throw new Error('No order rows found in this sales report')
  const { year, num } = periodNumForDate(sales.orders[0].placed_at)
  await upsertWoltPeriod({
    period_year: year,
    period_num: num,
    merchant_invoice_no: sales.merchantInvoiceNo,
  })
  return `Period ${year}-P${num} confirmed (merchant invoice ${sales.merchantInvoiceNo || 'n/a'})`
}

async function processNetting(net) {
  const period = await findWoltPeriodByInvoiceNo({
    woltInvoiceNo: net.woltInvoiceNo,
    merchantInvoiceNo: net.merchantInvoiceNo,
  })
  if (!period) {
    throw new Error('No matching period found — upload the Wolt→Merchant and Merchant→Wolt invoices for this period too')
  }
  const installments_amount = (net.deductions || []).reduce((s, d) => s + (d.installment_amount || 0), 0)
  await upsertWoltPeriod({
    period_year: period.period_year,
    period_num: period.period_num,
    netting_no: net.nettingNo,
    withholding_amount: net.withholdingAmount,
    withholding_pct: net.withholdingPct,
    installments_amount,
    net_payout: net.netPayout,
  })
  await replaceWoltDeductions(period.id, net.deductions)
  return `Period ${period.period_year}-P${period.period_num} updated (net payout ${net.netPayout})`
}

async function processCsvItems(filename, csvText) {
  const m = filename.match(/items_(\d{4}-\d{2}-\d{2})_/)
  if (!m) throw new Error("Filename doesn't match the expected items export pattern (items_YYYY-MM-DD_...)")
  const monthStart = m[1]
  const items = parseCsvItems(csvText, { monthStart })
  if (!items.length) throw new Error('Parsed to 0 item rows — wrong file?')
  await replaceWoltPeriodItems(monthStart, items)
  return `${items.length} item rows saved for month starting ${monthStart}`
}

async function processCsvPurchases(csvText) {
  const orders = parseCsvPurchases(csvText)
  if (!orders.length) throw new Error('Parsed to 0 order rows — wrong file?')

  const byPeriod = new Map()
  for (const o of orders) {
    const { year, num } = periodNumForDate(o.placed_at)
    const key = `${year}-${num}`
    if (!byPeriod.has(key)) byPeriod.set(key, { year, num, orders: [] })
    byPeriod.get(key).orders.push(o)
  }

  const summaries = []
  let anyImported = false
  for (const { year, num, orders: pOrders } of byPeriod.values()) {
    const periodId = await findWoltPeriodId(year, num)
    if (!periodId) {
      summaries.push(`period ${year}-P${num}: SKIPPED (${pOrders.length} orders, no matching period — upload its invoices first)`)
      continue
    }
    const orderRows = pOrders.map((o) => ({
      order_no_public: o.order_no_public,
      order_line_no: null,
      placed_at: o.placed_at,
      delivered_at: o.delivered_at,
      status: o.status,
      channel: o.channel,
      is_woltplus: false,
      price_incl_vat: o.price_incl_vat,
      price_excl_vat: null,
      review_score: o.review_score,
      review_comment: o.review_comment,
      review_attributions: o.review_attributions,
    }))
    const inserted = await replaceWoltOrders(periodId, orderRows)
    const idByOrderNo = new Map(inserted.map((r) => [r.order_no_public, r.id]))
    for (const o of pOrders) {
      const orderId = idByOrderNo.get(o.order_no_public)
      if (orderId && o.items?.length) await insertWoltOrderItems(orderId, o.items)
    }
    anyImported = true
    summaries.push(`period ${year}-P${num}: ${orderRows.length} orders imported`)
  }

  if (!anyImported) throw new Error(summaries.join('; '))
  return summaries.join('; ')
}
```

- [ ] **Step 2: Verify with the dev server + a fabricated purchases CSV (no real Wolt files needed)**

Start the dev server if it isn't already running: `npm run dev` (background).

Create a throwaway fixture at `/tmp/purchases-fixture.csv` with one order dated inside period 9 (2026-05-01 to 2026-05-15, already in the DB — see Task 3):

```bash
cat > /tmp/purchases-fixture.csv << 'EOF'
Order number,Order placed,Delivery time,Delivery type,Delivery status,Price,Review score,Review comment,Review attributions,Items
TESTORDER1,03/05/2026, 12:00,Wolt delivery,delivered,45,5,Great!,,1x Iced Latte 45 ILS
EOF
```

The admin cookie value is `sha256(ADMIN_PASSWORD)` (see `src/lib/admin.js`'s `adminToken()`), so it can be computed directly instead of copying it out of a browser:

```bash
ADMIN_COOKIE=$(node --env-file=.env.local -e "console.log(require('crypto').createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex'))")
curl -s -b "ss_admin=$ADMIN_COOKIE" \
  -F "files=@/tmp/purchases-fixture.csv;type=text/csv" \
  http://localhost:3000/api/admin/wolt/upload | python3 -m json.tool
```

Expected: `{"results": [{"filename": "purchases-fixture.csv", "detected_type": "csv_purchases", "status": "ok", "detail": "period 2026-P9: 1 orders imported"}]}`

Then confirm the row landed:

```bash
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const { data } = await supabase.from('wolt_orders').select('order_no_public, price_incl_vat').eq('order_no_public', 'TESTORDER1');
  console.log(data);
})();
"
```

Expected: one row with `price_incl_vat: 45`.

- [ ] **Step 3: Verify idempotency — re-run the same curl command**

Run the exact same `curl` command from Step 2 again.
Expected: same success response, and the DB check still shows exactly **one** `TESTORDER1` row (not two) — confirms `replaceWoltOrders`' delete-then-insert behavior prevents duplicates.

- [ ] **Step 4: Verify the "no matching period" error path**

Edit the fixture's date to `03/06/2026` (June — no period exists for it) and re-upload:

```bash
curl -s -b "ss_admin=$ADMIN_COOKIE" -F "files=@/tmp/purchases-fixture.csv;type=text/csv" http://localhost:3000/api/admin/wolt/upload
```

Expected: `"status": "error"` with a detail mentioning "no matching period" for period 2026-P11.

- [ ] **Step 5: Clean up the test order and commit**

```bash
node --env-file=.env.local -e "
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  await supabase.from('wolt_orders').delete().eq('order_no_public', 'TESTORDER1');
  console.log('cleaned up');
})();
"
```

```bash
git add src/app/api/admin/wolt/upload/route.js
git commit -m "Add Wolt upload API route with content-based classification"
```

---

### Task 5: Upload UI

**Files:**
- Create: `src/app/admin/(dashboard)/wolt/UploadCard.js`

**Interfaces:**
- Consumes: `POST /api/admin/wolt/upload` (Task 4), response shape `{ results: [{ filename, detected_type, status, detail }] }` or `{ error }`.
- Produces: default export `UploadCard()` — a client component with no props, rendered by Task 6.

- [ ] **Step 1: Create the component**

Create `src/app/admin/(dashboard)/wolt/UploadCard.js`:

```jsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UploadCard() {
  const router = useRouter()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  function onFilesChange(e) {
    setFiles([...(e.target.files || [])])
    setResults(null)
    setError(null)
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (!files.length || busy) return
    setBusy(true)
    setResults(null)
    setError(null)
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    try {
      const res = await fetch('/api/admin/wolt/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Upload failed')
      } else {
        setResults(json.results)
        router.refresh()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setFiles([])
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Upload Wolt files</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Drop any mix of Wolt PDFs (invoices, netting, sales reports) and CSVs (items, purchases) —
        any period, any order, any time. Each file is identified automatically.
      </p>
      <form onSubmit={onSubmit} className="stack" style={{ gap: 12 }}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.csv"
          onChange={onFilesChange}
          disabled={busy}
        />
        {files.length > 0 && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {files.length} file{files.length > 1 ? 's' : ''} selected
          </span>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!files.length || busy}>
            {busy ? 'Uploading…' : 'Upload & process'}
          </button>
        </div>
      </form>

      {error && (
        <div className="insight bad" style={{ marginTop: 12 }}>
          <div className="insight-title">⚠ Upload failed</div>
          <div className="insight-body">{error}</div>
        </div>
      )}

      {results && <ResultsList results={results} />}
    </div>
  )
}

function ResultsList({ results }) {
  const anyError = results.some((r) => r.status === 'error')
  return (
    <div className={`insight ${anyError ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
      <div className="insight-title">
        {anyError ? '⚠' : '✓'} {results.length} file{results.length > 1 ? 's' : ''} processed
      </div>
      <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, fontSize: '0.8rem' }}>
        {results.map((r, i) => (
          <li key={i} style={{ color: r.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
            {r.status === 'ok' ? '✓' : '✗'} {r.filename} ({r.detected_type}) — {r.detail}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Sanity-check it compiles**

Run: `npm run lint`
Expected: no new errors reported for this file.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/(dashboard)/wolt/UploadCard.js"
git commit -m "Add Wolt UploadCard dropzone component"
```

---

### Task 6: Wire UploadCard into the Wolt page

**Files:**
- Modify: `src/app/admin/(dashboard)/wolt/page.js:1-9` (imports), `:170-177` (main view header), `:633-639` (`EmptyState`)

**Interfaces:**
- Consumes: `UploadCard` default export from `./UploadCard` (Task 5).

- [ ] **Step 1: Add the import**

In `src/app/admin/(dashboard)/wolt/page.js`, change lines 1-9 from:

```js
import {
  getWoltPeriodSummaries,
  getTopItemsByMonth,
  getCategorySalesByMonth,
  getLastIpadDeduction,
  getRecentLowReviews,
  getReviewBreakdownByMonth,
} from '@/lib/db/wolt'
import './wolt.css'
```

to:

```js
import {
  getWoltPeriodSummaries,
  getTopItemsByMonth,
  getCategorySalesByMonth,
  getLastIpadDeduction,
  getRecentLowReviews,
  getReviewBreakdownByMonth,
} from '@/lib/db/wolt'
import UploadCard from './UploadCard'
import './wolt.css'
```

- [ ] **Step 2: Render it in the empty state**

Change the `EmptyState` function (around line 633) from:

```js
function EmptyState() {
  return (
    <div className="card">
      <h2 className="section-h2">No Wolt data yet</h2>
      <p className="muted">Run the backfill script (<code>scripts/backfill-wolt.mjs</code>) or upload a period.</p>
    </div>
  )
```

to:

```js
function EmptyState() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <UploadCard />
      <div className="card">
        <h2 className="section-h2">No Wolt data yet</h2>
        <p className="muted">Upload your Wolt files above to get started.</p>
      </div>
    </div>
  )
```

(the closing `}` two lines below is unchanged — only the `<p className="muted">` line and the wrapping JSX change).

- [ ] **Step 3: Render it in the main loaded view**

Change the top of the main `return` (around line 170-177) from:

```jsx
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Wolt — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {totalMonths} month{totalMonths > 1 ? 's' : ''} of data loaded
        </span>
      </div>
```

to:

```jsx
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Wolt — {monthLabel}</h1>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {totalMonths} month{totalMonths > 1 ? 's' : ''} of data loaded
        </span>
      </div>

      <UploadCard />
```

- [ ] **Step 4: Verify in the browser**

With the dev server running, visit `http://localhost:3000/admin/wolt` (log in as admin if prompted). Confirm:
- The "Upload Wolt files" card renders above the KPI row.
- Selecting a file enables the "Upload & process" button; submitting with no file keeps it disabled.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/(dashboard)/wolt/page.js"
git commit -m "Render UploadCard on the Wolt admin page"
```

---

### Task 7: Full end-to-end pass with real Wolt files

This task cannot be completed by an agent without access to real Wolt PDF exports (none exist in this environment — the historical `../data/wolt/2026` folder used to develop the original parsers is not present on this machine). It must be run by the person implementing this plan once they have the owner's actual Wolt files at hand, before considering the feature done.

- [ ] **Step 1:** Gather one full period's files (4 PDFs: Wolt→Merchant invoice, Merchant→Wolt invoice, netting report, sales report) plus that month's 2 CSVs (items, purchases) for a period **not yet in the DB** (anything after May 2026 — periods 7-10 are already loaded).
- [ ] **Step 2:** Drop all 6 files into the UploadCard at once. Confirm the results checklist shows 6× `status: ok`, with the 4 PDFs identified as their correct types and the period number matching what you'd expect from the dates.
- [ ] **Step 3:** Open `/admin/wolt` for that month and confirm the KPIs, money waterfall, and top-items table populate exactly as they would from a `backfill-wolt.mjs` run against the same files.
- [ ] **Step 4:** Re-upload the same 6 files a second time. Confirm the dashboard numbers are unchanged (no duplication) — this is the real-world idempotency check that Task 4's fabricated-CSV check could only approximate.
- [ ] **Step 5:** Try uploading just the netting report and sales report for a period whose invoices haven't been uploaded yet. Confirm both come back `status: error` with the "upload the invoices first" message, and that nothing was written for that period.
