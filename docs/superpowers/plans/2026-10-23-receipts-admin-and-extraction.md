# Receipts — Admin Page and Extraction (Phases 3 + 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner opens **Receipts** in the admin, sees every receipt of a month with its photo, corrects any field, downloads a CSV and a ZIP for the accountant, and the date, time, vendor, total, and receipt number fill in automatically from the photo.

**Architecture:** Phase 3 first: a server-rendered `/admin/receipts` page over the existing `receipts` table, a client table that PATCHes edits, and two export routes. Then Phase 2: a pure request/response layer around `claude-haiku-5-5`, a `processReceipt(id)` job that reads the photo from S3, writes the fields, computes VAT, and marks duplicates. The job runs from `after()` in the upload route and from a sweep the admin page starts on load.

**Tech Stack:** Next.js 16.2.6 App Router (plain JS), Supabase JS, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (installed), new: `@anthropic-ai/sdk@0.132.1`, `archiver@8.0.0`. Verification is plain Node scripts under `scripts/verify/`, as in Phase 1.

**Spec:** `docs/superpowers/specs/2026-10-21-receipt-capture-design.md` — sections 3–6, the Data model, and the **Amendments — 2026-10-23** section, which wins where they disagree.

## Revision — 2026-10-23: Claude through Amazon Bedrock

The owner chose Bedrock over the Anthropic API, to keep the cost on the AWS bill.
This supersedes the plan text below wherever they disagree.

- Packages: `@anthropic-ai/sdk@0.132.1` and `@anthropic-ai/bedrock-sdk@0.34.4`
  (both published before 2026-10-09; the Bedrock package needs `@anthropic-ai/sdk`
  `>=0.115.1 <1`).
- Client: `import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'`,
  `new AnthropicBedrockMantle({ awsRegion, awsAccessKey, awsSecretAccessKey })`.
  The option is `awsSecretAccessKey` (from the package's `mantle-client.d.ts`), not
  the legacy client's `awsSecretKey`.
- Model ID: `anthropic.claude-haiku-5-5`. The request body is unchanged.
- Environment: `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`,
  `BEDROCK_AWS_REGION` (default `us-east-1`). The `AWS_` prefix is avoided, because
  Amplify reserves it. These replace `ANTHROPIC_API_KEY` everywhere in this plan.
- AWS setup (owner): enable Claude Haiku 5.5 under Bedrock → Model access, and give
  the user behind those keys `bedrock-mantle:CreateInference`.
- Task 9's integration test skips when `BEDROCK_AWS_ACCESS_KEY_ID` is unset.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/01-app/` before writing a route, page, or `after()` call (AGENTS.md). Route `params` are a Promise: `const { id } = await params`.
- Every admin route starts with `if (!(await isAdmin())) return 401`, as in `src/app/api/admin/expenses/[id]/route.js`.
- VAT: `vat_amount = round(total * 0.18 / 1.18, 2)`, `net_amount = total - vat_amount`. Store `vat_rate` and `vat_amount` on the row. Recompute on every change of `total`.
- Effective month: the month of `purchased_at` when set, else the month of `uploaded_at` **in Asia/Jerusalem**. The page, the CSV, and the ZIP use the one function that implements this.
- A row with `duplicate_of` set is shown greyed, and is excluded from the CSV, the ZIP, and every total.
- Duplicate rule: same `purchased_at` and same `total`, **and** (same `purchased_time` or same `receipt_number`, compared only when both sides are non-null). Never flag when both time and number are missing.
- Extraction never overwrites a row whose `parse_status` is `reviewed`.
- Model `claude-haiku-5-5`, `max_tokens: 2000`, `output_config: { effort: 'medium', format: { type: 'json_schema', schema } }`, `client.messages.create`. No `thinking` parameter, no prefill, no `fallbacks` (Haiku has no server-side fallback). A `stop_reason` of `refusal` or `max_tokens` is an extraction error, not a crash.
- `ANTHROPIC_API_KEY` comes from the environment. Never log it.
- Deleting a receipt row keeps its S3 object.
- The extract routes are admin-only, under `/api/admin/receipts/`. This replaces the public `/api/receipts/[id]/extract` in the spec's route table: the upload route calls `processReceipt` directly, so nothing public needs to trigger a paid API call.
- The CSV starts with `﻿` and quotes any field holding `,` `"` or a newline (doubling `"`).
- Default month on the page: the current month in Asia/Jerusalem when `?month=` is absent.

## Review Focus

1. **A receipt whose date the model cannot read.** Expected: it shows in the upload month with an empty date. When the owner types the date, it moves to that month after a refresh. Pinned in Task 1's month test and Task 4's PATCH check.
2. **Two real ₪10.90 purchases at one shop on one day, no time or number printed.** Expected: neither is flagged. Pinned in Task 2's duplicate test.
3. **The owner corrects the total, then a sweep or Retry runs.** Expected: the correction stays, and VAT follows the corrected total. Pinned in Task 4's PATCH check and Task 9's "reviewed is never overwritten" test.
4. **A month with no receipts.** Expected: an empty-state line, a CSV with only the header, and a ZIP with only `receipts.csv`. Pinned in Task 3's CSV test and Task 6's export check.
5. **A vendor name with a comma, a quote, or Hebrew.** Expected: the CSV opens in Excel with one cell per field and readable Hebrew. Pinned in Task 3's CSV test.

---

## File Structure

**Create:**
- `src/lib/receipts/month.js` — `receiptMonthBounds`, `currentIsraelMonth` (pure).
- `src/lib/receipts/money.js` — `vatAmount`, `netAmount`, `summarizeReceipts` (pure).
- `src/lib/receipts/duplicates.js` — `findDuplicateOf` (pure).
- `src/lib/receipts/exportFormat.js` — `zipEntryName`, `receiptsCsv` (pure).
- `src/lib/receipts/extraction.js` — `buildExtractionRequest`, `parseExtraction` (pure).
- `src/lib/receipts/processReceipt.js` — `processReceipt(id)` (server-only).
- `src/app/admin/(dashboard)/receipts/page.js`, `ReceiptsTable.js`, `PendingSweeper.js`, `receipts.css`
- `src/app/api/admin/receipts/[id]/route.js` — PATCH, DELETE.
- `src/app/api/admin/receipts/[id]/extract/route.js` — POST (retry).
- `src/app/api/admin/receipts/extract-pending/route.js` — POST (sweep).
- `src/app/api/admin/receipts/export.csv/route.js`, `src/app/api/admin/receipts/export.zip/route.js`
- `scripts/verify/receipts-month.check.mjs`, `receipts-money.check.mjs`, `receipts-export.check.mjs`, `receipts-extraction.check.mjs`, `receipts-admin-db.check.mjs`, `receipts-process.check.mjs`

**Modify:**
- `supabase-finance-schema.sql` — two columns and one index.
- `src/lib/db/receipts.js` — list, get, update, delete, pending, duplicate candidates.
- `src/app/api/receipts/route.js` — server-side hash, `after()`.
- `src/components/ReceiptButton.js` — stop sending `sha256`.
- `src/lib/receipts/keys.js` — key from the server hash (signature unchanged).
- `src/app/admin/(dashboard)/layout.js` — nav link. `src/components/AdminMonthPickerSlot.js` — add `/admin/receipts`.
- `scripts/verify/receipts-route.check.mjs` — no `sha256` field.
- `package.json` — two dependencies.

---

### Task 1: Schema, month bounds, and the receipts DB layer

**Files:**
- Modify: `supabase-finance-schema.sql`, `src/lib/db/receipts.js`
- Create: `src/lib/receipts/month.js`
- Test: `scripts/verify/receipts-month.check.mjs`, `scripts/verify/receipts-admin-db.check.mjs`

**Interfaces:**
- Produces (`month.js`, pure, no `@/` imports):
  - `receiptMonthBounds(month: 'YYYY-MM'): { dateFrom, dateTo, uploadedFrom, uploadedTo }` — dates are `'YYYY-MM-DD'` (from inclusive, to exclusive, first of next month). The two timestamps are ISO UTC strings for Israel midnight at the start of this month and of the next.
  - `currentIsraelMonth(now = new Date()): 'YYYY-MM'`
- Produces (`db/receipts.js`, server-only; keep the two existing exports):
  - `listReceiptsForMonth(month): Promise<Row[]>` — effective-month rule via `.or('and(purchased_at.gte.<dateFrom>,purchased_at.lt.<dateTo>),and(purchased_at.is.null,uploaded_at.gte.<uploadedFrom>,uploaded_at.lt.<uploadedTo>)')`, ordered by `purchased_at` then `uploaded_at`, selecting `*, employees(name)`.
  - `getReceipt(id): Promise<Row|null>`
  - `updateReceipt(id, fields): Promise<Row>` — always sets `updated_at`.
  - `deleteReceipt(id): Promise<void>`
  - `listPendingReceipts(limit): Promise<Row[]>` — `parse_status = 'pending'`, oldest first.
  - `countPendingReceipts(): Promise<number>` — across all months.
  - `listDuplicateCandidates({ purchasedAt, total, excludeId }): Promise<Row[]>` — same date and total, `duplicate_of is null`, `id <> excludeId`, ordered by `uploaded_at`.

- [ ] **Step 1: Append the migration to `supabase-finance-schema.sql`**

Under the receipts section, idempotent:

```sql
alter table receipts add column if not exists purchased_time time;
alter table receipts add column if not exists duplicate_of uuid references receipts(id) on delete set null;
create index if not exists receipts_dup_lookup_idx on receipts (purchased_at, total);
```

- [ ] **Step 2: The owner runs Step 1's SQL in the Supabase SQL editor.** Expected: `Success. No rows returned`. Tasks 1–9 need it.

- [ ] **Step 3: Write the failing month test** — `receipts-month.check.mjs`, same style as `receipts-keys.check.mjs`:

```js
[receiptMonthBounds('2026-10'), { dateFrom: '2026-10-01', dateTo: '2026-11-01', uploadedFrom: '2026-09-30T21:00:00.000Z', uploadedTo: '2026-10-31T22:00:00.000Z' }], // IDT→IST change on 25 Oct
[receiptMonthBounds('2026-12').dateTo, '2027-01-01'],
[receiptMonthBounds('2026-12').uploadedTo, '2026-12-31T22:00:00.000Z'],
[currentIsraelMonth(new Date('2026-10-31T22:30:00Z')), '2026-11'],
[currentIsraelMonth(new Date('2026-10-31T21:30:00Z')), '2026-10'],
```

- [ ] **Step 4: Run it** — `node scripts/verify/receipts-month.check.mjs` → FAIL, module not found.

- [ ] **Step 5: Implement `month.js`.** For Israel midnight: take `Date.UTC(y, m-1, 1)`, read the Asia/Jerusalem offset at that instant with `Intl.DateTimeFormat(..., { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' })`, subtract it.

- [ ] **Step 6: Run it** → `PASS — all 5 cases`.

- [ ] **Step 7: Write the failing DB test** — `receipts-admin-db.check.mjs` (run with `--env-file=.env.local --import ./scripts/verify/alias-loader.mjs`). Insert three rows with hashes `'e1'.repeat(32)`, `'e2'…`, `'e3'…`, keys `receipts/00_0000/…`:
  - A: `purchased_at '2026-03-10'`, `total 10.90`, `purchased_time '09:15:00'`
  - B: `purchased_at null`, `uploaded_at '2026-03-31T22:30:00Z'` (1 April in Israel)
  - C: `purchased_at '2026-03-10'`, `total 10.90`, `duplicate_of` = A

  Assert: `listReceiptsForMonth('2026-03')` ids ⊇ {A, C} and excludes B. `listReceiptsForMonth('2026-04')` includes B. `listDuplicateCandidates({ purchasedAt: '2026-03-10', total: 10.90, excludeId: 'x' })` returns A only. `updateReceipt(A, { vendor: 'Test' })` returns a row with `vendor 'Test'`. `deleteReceipt` all three in a `finally`, then `getReceipt(A) === null`.

- [ ] **Step 8: Run it** → FAIL (missing exports).
- [ ] **Step 9: Implement the six DB functions.**
- [ ] **Step 10: Run it** → `PASS`.
- [ ] **Step 11: Commit** — `Add receipts month bounds, DB queries, and time/duplicate columns`.

---

### Task 2: VAT, totals, and the duplicate rule

**Files:**
- Create: `src/lib/receipts/money.js`, `src/lib/receipts/duplicates.js`
- Test: `scripts/verify/receipts-money.check.mjs`

**Interfaces:**
- `vatAmount(total: number|null, rate = 0.18): number|null` — `null` in, `null` out.
- `netAmount(total, vat): number|null`
- `summarizeReceipts(rows): { count, total, vat }` — skips rows with `duplicate_of`. Missing totals count as receipts but add 0.
- `findDuplicateOf(receipt, candidates): string|null` — the id of the earliest candidate that matches the Global Constraints rule, skipping `receipt.id` itself.

- [ ] **Step 1: Write the failing test** — `receipts-money.check.mjs`:

```js
[vatAmount(48.60), 7.41],            // the reference receipt prints 7.41
[vatAmount(100), 15.25],
[vatAmount(0), 0],
[vatAmount(null), null],
[netAmount(48.60, 7.41), 41.19],     // printed "before VAT" on the reference receipt
[summarizeReceipts([{ total: 48.6, vat_amount: 7.41 }, { total: 10, vat_amount: 1.53, duplicate_of: 'a' }, { total: null, vat_amount: null }]), { count: 2, total: 48.6, vat: 7.41 }],
// duplicates
[findDuplicateOf({ id: 'n', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38', receipt_number: null }, [{ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38', receipt_number: null }]), 'a'],
[findDuplicateOf({ id: 'n', purchased_at: '2026-10-21', total: 48.6, purchased_time: null, receipt_number: '614461' }, [{ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: null, receipt_number: '614461' }]), 'a'],
[findDuplicateOf({ id: 'n', purchased_at: '2026-10-21', total: 10.9, purchased_time: null, receipt_number: null }, [{ id: 'a', purchased_at: '2026-10-21', total: 10.9, purchased_time: null, receipt_number: null }]), null], // two real purchases
[findDuplicateOf({ id: 'n', purchased_at: '2026-10-21', total: 10.9, purchased_time: '10:00:00', receipt_number: null }, [{ id: 'a', purchased_at: '2026-10-21', total: 10.9, purchased_time: '11:00:00', receipt_number: null }]), null],
[findDuplicateOf({ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38' }, [{ id: 'a', purchased_at: '2026-10-21', total: 48.6, purchased_time: '20:23:38' }]), null], // not itself
```

Compare with `JSON.stringify`. Compare totals as numbers (Supabase returns `numeric` as a string or number — normalize with `Number()` inside `findDuplicateOf`).

- [ ] **Step 2: Run it** → FAIL. **Step 3: Implement.** **Step 4: Run it** → `PASS — all 11 cases`.
- [ ] **Step 5: Commit** — `Add receipt VAT, totals, and duplicate rule`.

---

### Task 3: CSV and ZIP naming

**Files:**
- Create: `src/lib/receipts/exportFormat.js`
- Test: `scripts/verify/receipts-export.check.mjs`

**Interfaces:**
- Consumes: Task 2 `vatAmount`, `netAmount`.
- `zipEntryName(row): string` — `${date}_${vendor}_${amount}_${row.id.slice(0,8)}.jpg`. `date` = `purchased_at`, else the Israel date of `uploaded_at`. `vendor` = the vendor with every run of `/[\s/\\:*?"<>|,]+/g` replaced by one `-`, leading and trailing `-` removed, cut to 40 characters; `unknown` when that leaves nothing. `amount` = `total.toFixed(2)`, else `no-amount`.
- `receiptsCsv(rows): string` — BOM, then header `date,time,vendor,receipt_number,amount,vat_rate,vat_amount,net_amount,uploaded_by,image_file`, then one line per row **without** `duplicate_of`, CRLF line ends. `uploaded_by` = `row.employees?.name ?? ''`.

- [ ] **Step 1: Write the failing test:**

```js
const r = { id: 'a1b2c3d4-0000-0000-0000-000000000000', purchased_at: '2026-10-03', purchased_time: '09:15:00', vendor: 'רמי לוי', receipt_number: '77', total: 147.5, vat_rate: 0.18, vat_amount: 22.5, employees: { name: 'Anastasia' }, uploaded_at: '2026-10-03T07:00:00Z' }
[zipEntryName(r), '2026-10-03_רמי-לוי_147.50_a1b2c3d4.jpg'],
[zipEntryName({ ...r, vendor: null, total: null, purchased_at: null, uploaded_at: '2026-10-31T22:30:00Z' }), '2026-11-01_unknown_no-amount_a1b2c3d4.jpg'],
[receiptsCsv([]), '﻿date,time,vendor,receipt_number,amount,vat_rate,vat_amount,net_amount,uploaded_by,image_file\r\n'],
[receiptsCsv([{ ...r, vendor: 'Cafe "Joe", Haifa' }]).split('\r\n')[1], '2026-10-03,09:15:00,"Cafe ""Joe"", Haifa",77,147.50,0.18,22.50,125.00,Anastasia,2026-10-03_Cafe-Joe-Haifa_147.50_a1b2c3d4.jpg'],
[receiptsCsv([r, { ...r, id: 'b', duplicate_of: r.id }]).split('\r\n').length, 3], // header + 1 row + trailing ''
```

The fourth case pins the quoting of the vendor cell. `vat_amount` comes from the row, and `net_amount` is `total - vat_amount`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → `PASS — all 5 cases`.
- [ ] **Step 5: Commit** — `Add receipt CSV and ZIP naming`.

---

### Task 4: Admin edit and delete API

**Files:**
- Create: `src/app/api/admin/receipts/[id]/route.js`

**Interfaces:**
- Consumes: Task 1 `getReceipt`, `updateReceipt`, `deleteReceipt`. Task 2 `vatAmount`.
- `PATCH` body may hold only: `purchased_at` (`YYYY-MM-DD` or null), `purchased_time` (`HH:MM` or `HH:MM:SS` or null), `vendor`, `receipt_number`, `notes` (string ≤ 200 or null), `total` (number ≥ 0, ≤ 2 decimals, or null), `duplicate_of` (**only** `null` — clears the mark). Any other key or invalid value → `400 { error }`. Empty strings become `null`.
- On success: when `total` is present, also set `vat_rate: 0.18` and `vat_amount: vatAmount(total)`. Always set `parse_status: 'reviewed'`, `reviewed_at: now`. Return `200 { receipt }`.
- `DELETE` → `200 { ok: true }`. The S3 object stays.
- Unknown id → `404`. Not admin → `401`.

- [ ] **Step 1: Implement the route.**
- [ ] **Step 2: Verify with curl** against `npm run dev`. Admin cookie: `ADMIN_COOKIE=$(node --env-file=.env.local -e "console.log(require('crypto').createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex'))")`, send as `-b "ss_admin=$ADMIN_COOKIE"`. Use a throwaway row created by a one-line Node insert (hash `'d0'.repeat(32)`), deleted at the end.
  - no cookie → `401`
  - `{"color":"red"}` → `400`
  - `{"total":"abc"}` → `400`
  - `{"total":48.6}` → `200`, `vat_amount` `7.41`, `parse_status` `reviewed`
  - `{"purchased_at":"2026-10-21","purchased_time":"20:23"}` → `200`
  - `{"duplicate_of":"<any uuid>"}` → `400`
  - `DELETE` → `200`, then PATCH → `404`
- [ ] **Step 3: Commit** — `Add admin receipt edit and delete API`.

---

### Task 5: The Receipts admin page

**Files:**
- Create: `src/app/admin/(dashboard)/receipts/page.js`, `ReceiptsTable.js`, `receipts.css`
- Modify: `src/app/admin/(dashboard)/layout.js` (add `<NavLink href="/admin/receipts">Receipts</NavLink>` after Expenses), `src/components/AdminMonthPickerSlot.js` (add `'/admin/receipts'`)

**Interfaces:**
- Consumes: Task 1 `listReceiptsForMonth`, `currentIsraelMonth`. Task 2 `summarizeReceipts`, `vatAmount`. Task 4 PATCH/DELETE. `s3Client`, `s3Bucket` from `src/lib/s3.js`.
- `page.js` (server, `dynamic = 'force-dynamic'`): month = valid `?month=` or `currentIsraelMonth()`. For each row, a presigned **GET** URL (`GetObjectCommand`, 3600 s) as `imageUrl`. Header: `Receipts — <Month YYYY>` and the summary line `<count> receipt(s) · ₪<total> · VAT ₪<vat>` (singular for 1, amounts with 2 decimals) from `summarizeReceipts`. Two links: `Download CSV` → `/api/admin/receipts/export.csv?month=…`, `Download ZIP` → `/api/admin/receipts/export.zip?month=…`. Empty month → `No receipts this month.`
- `ReceiptsTable` (client, props `initial`): columns Photo (56 px thumbnail, `loading="lazy"`, link opens `imageUrl` in a new tab), Date, Time, Vendor, Receipt no., Amount, VAT (read-only, recomputed locally with `vatAmount` while editing), Uploaded by, Status, actions. Text inputs save on blur and on Enter with PATCH, only when the value changed. Optimistic update, roll back on failure (pattern: `expenses/ExpensesTable.js`). Status badge: `pending` / `parsed` / `error` (shows `parse_error` as a tooltip) / `reviewed`. Rows with `duplicate_of`: class `row-dim` and a `Duplicate · Not a duplicate` button that PATCHes `{ duplicate_of: null }`. Delete button with an inline confirm (no `window.confirm`). Rows needing attention sort first: `error`, then `pending`, then the rest by date.

- [ ] **Step 1: Implement the page, table, CSS, nav, and month-picker entry.**
- [ ] **Step 2: Build** — `npm run build` → exit 0. `npm run lint` → no problems beyond main's 9.
- [ ] **Step 3: Check in a browser** (headless Chromium driver from Phase 1 with the admin cookie set; desktop width 1280, and 390):
  1. **Receipts** is in the nav, and the month picker shows.
  2. October 2026 lists the owner's two `IMG_9420.jpeg` rows with thumbnails that load.
  3. Edit the vendor of one row, reload → the value stays. Then restore it to empty.
  4. A month with no rows → `No receipts this month.`
  5. No console errors.
- [ ] **Step 4: Commit** — `Add Receipts admin page`.

---

### Task 6: CSV and ZIP exports

**Files:**
- Create: `src/app/api/admin/receipts/export.csv/route.js`, `src/app/api/admin/receipts/export.zip/route.js`
- Modify: `package.json` (`npm install archiver@8.0.0`)

**Interfaces:**
- Consumes: Task 1 `listReceiptsForMonth`. Task 3 `receiptsCsv`, `zipEntryName`.
- `GET export.csv?month=YYYY-MM` → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="receipts-YYYY-MM.csv"`. Bad or missing month → `400`.
- `GET export.zip?month=YYYY-MM` → builds the archive in memory with `archiver('zip')` (each non-duplicate photo under its `zipEntryName`, plus `receipts.csv`), fetches photos from S3 with at most 5 in flight, writes the ZIP to S3 at `receipts/exports/receipts-YYYY-MM-<Date.now()>.zip`, then responds `303` to a presigned GET URL (300 s, `ResponseContentDisposition: attachment; filename="receipts-YYYY-MM.zip"`). This keeps the large file out of the function response.

- [ ] **Step 1: Install archiver and implement both routes.**
- [ ] **Step 2: Verify with curl** (admin cookie as in Task 4):
  - CSV for `2026-10`: first 3 bytes are `EF BB BF` (`head -c 3 | xxd`), header line matches Task 3, and one line per non-duplicate October row.
  - CSV for `2026-01` → only the header.
  - ZIP for `2026-10`: `curl -sL -o /tmp/r.zip …` then `unzip -l` lists one `.jpg` per non-duplicate row plus `receipts.csv`. The image names match the CSV `image_file` column.
  - ZIP for `2026-01` → only `receipts.csv`.
  - No cookie → `401` for both.
- [ ] **Step 3: Commit** — `Add receipt CSV and ZIP exports`.

---

### Task 7: Hash the stored JPEG on the server

**Files:**
- Modify: `src/app/api/receipts/route.js`, `src/components/ReceiptButton.js`, `scripts/verify/receipts-route.check.mjs`

**Interfaces:**
- The route computes `createHash('sha256').update(bytes).digest('hex')` from the received JPEG and uses it for the duplicate lookup, the key, and `image_sha256`. It no longer reads a `sha256` field. `ReceiptButton` stops computing and sending it (keep `sha256Hex` in `prepareImage.js`; the image check still covers it).

- [ ] **Step 1: Update the route check first.** Remove the `sha256` field and the "bad sha256" case. Add: two posts of the **same bytes** with **different** `fileName` values → the same `id`. Run with `RECEIPTS_DB=skip` → the validation cases fail on the old "sha256 must be…" error (RED).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `node scripts/verify/receipts-route.check.mjs` (full) → `PASS`. Delete the row it reports, with its S3 object.
- [ ] **Step 4: Browser driver** → upload and same-photo cases still show the thank-you box (`PASS`).
- [ ] **Step 5: Commit** — `Hash the stored receipt JPEG on the server`.

---

### Task 8: The extraction request and its parser

**Files:**
- Create: `src/lib/receipts/extraction.js`
- Modify: `package.json` (`npm install @anthropic-ai/sdk@0.132.1`)
- Test: `scripts/verify/receipts-extraction.check.mjs`

Read `typescript/claude-api/README.md` (Vision, base64) and the Structured Outputs section of `typescript/claude-api/tool-use.md` in the `claude-api` skill before writing this. After installing, confirm the SDK types know `output_config`: `grep -rl "output_config" node_modules/@anthropic-ai/sdk/resources/messages/*.d.ts` → at least one file. If none, stop and report: the version is too old for structured outputs.

**Interfaces:**
- `EXTRACTION_MODEL = 'claude-haiku-5-5'`
- `buildExtractionRequest(jpegBase64: string): object` — the full `messages.create` params: model, `max_tokens: 2000`, `output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } }`, one user message with the image block (`media_type: 'image/jpeg'`) **before** the text block.
- `RECEIPT_SCHEMA` — object, `additionalProperties: false`, all six properties required, each nullable via `anyOf: [{ type: … }, { type: 'null' }]`: `purchased_at` (string), `purchased_time` (string), `vendor` (string), `receipt_number` (string), `total` (number), `legible` (boolean, not nullable).
- Prompt text (exact): `This is a photo of a purchase receipt, usually Israeli and in Hebrew. Read: purchased_at as YYYY-MM-DD; purchased_time as HH:MM:SS (24-hour) if printed; vendor as the business name printed at the top; receipt_number as the receipt or tax-invoice number (מס' קבלה / חשבונית מס); total as the final amount paid (סה"כ לתשלום) as a number. Use null for any field you cannot read with confidence. A wrong value is worse than null. Set legible to false if the photo is not a readable receipt.`
- `parseExtraction(response): { purchased_at, purchased_time, vendor, receipt_number, total, ai_confidence, raw }` — throws `Error('Model refused')` on `stop_reason === 'refusal'` and `Error('Model output was cut off')` on `max_tokens`. Reads the first `text` block (thinking blocks may come first), `JSON.parse`s it, then normalizes: date must be a real `YYYY-MM-DD` else null; time `HH:MM` gets `:00`, other shapes null; total a finite number ≥ 0 rounded to 2 decimals else null; strings trimmed, empty → null. `ai_confidence` = `'high'` if `legible` and `total` and `purchased_at` are non-null, else `'low'`. `raw` = the parsed JSON.

- [ ] **Step 1: Write the failing test** with fake responses:

```js
const ok = (json) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }] })
const ref = { purchased_at: '2026-10-21', purchased_time: '20:23:38', vendor: ' גם סטוק נווה שאנן ', receipt_number: '614461', total: 48.6, legible: true }
// parse
[parseExtraction(ok(ref)).vendor, 'גם סטוק נווה שאנן'],
[parseExtraction(ok(ref)).ai_confidence, 'high'],
[parseExtraction(ok({ ...ref, purchased_time: '20:23' })).purchased_time, '20:23:00'],
[parseExtraction(ok({ ...ref, purchased_at: '2026-02-30' })).purchased_at, null],
[parseExtraction(ok({ ...ref, total: -5 })).total, null],
[parseExtraction(ok({ ...ref, total: 48.604 })).total, 48.6],
[parseExtraction(ok({ ...ref, vendor: '' })).vendor, null],
[parseExtraction(ok({ ...ref, legible: false })).ai_confidence, 'low'],
[throws(() => parseExtraction({ stop_reason: 'refusal', content: [] })), 'Model refused'],
[throws(() => parseExtraction({ stop_reason: 'max_tokens', content: [] })), 'Model output was cut off'],
// request
[buildExtractionRequest('QUJD').model, 'claude-haiku-5-5'],
[buildExtractionRequest('QUJD').messages[0].content[0].type, 'image'],
[buildExtractionRequest('QUJD').output_config.format.schema.required.length, 6],
['thinking' in buildExtractionRequest('QUJD'), false],
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Install the SDK, check the types, implement.** **Step 4: Run** → `PASS — all 14 cases`.
- [ ] **Step 5: Commit** — `Add receipt extraction request and parser`.

---

### Task 9: Process receipts — after upload, on the admin page, and on Retry

**Files:**
- Create: `src/lib/receipts/processReceipt.js`, `src/app/api/admin/receipts/[id]/extract/route.js`, `src/app/api/admin/receipts/extract-pending/route.js`, `src/app/admin/(dashboard)/receipts/PendingSweeper.js`
- Modify: `src/app/api/receipts/route.js`, `src/app/admin/(dashboard)/receipts/page.js`, `ReceiptsTable.js`
- Test: `scripts/verify/receipts-process.check.mjs`

**Interfaces:**
- Consumes: Task 1 DB functions. Task 2 `vatAmount`, `findDuplicateOf`. Task 8 `buildExtractionRequest`, `parseExtraction`. `new Anthropic()` from `@anthropic-ai/sdk`.
- `processReceipt(id, { client } = {}): Promise<{ status: 'parsed'|'error'|'skipped', duplicateOf?: string }>`:
  1. `getReceipt(id)`. Missing or `reviewed` → `{ status: 'skipped' }`, no write.
  2. Read the JPEG from S3, base64 it, call `client.messages.create(buildExtractionRequest(b64))`, `parseExtraction`.
  3. Write the five fields, `ai_confidence`, `raw_extraction`, `vat_rate: 0.18`, `vat_amount: vatAmount(total)`, `parse_status: 'parsed'`, `parsed_at`, `parse_error: null`.
  4. When `purchased_at` and `total` are set: `findDuplicateOf(row, await listDuplicateCandidates(...))` → write `duplicate_of`.
  5. Any thrown error → `parse_status: 'error'`, `parse_error: e.message` (≤ 300 chars), return `{ status: 'error' }`. Never rethrow.
- Upload route: after `createReceipt` returns `created: true`, call `after(() => processReceipt(id))` (import `after` from `next/server`).
- `POST /api/admin/receipts/[id]/extract` → runs `processReceipt` and returns its result plus the updated row. Admin only. This is the per-row **Retry**, shown in the table for `pending` and `error` rows.
- `POST /api/admin/receipts/extract-pending` → processes up to 3 of `listPendingReceipts(3)` in sequence, returns `{ processed, remaining }` (`remaining` = pending count after). Admin only.
- `page.js` passes `countPendingReceipts()` (all months, not only the shown one) to `PendingSweeper`.
- `PendingSweeper` (client, prop `pendingCount`): when > 0, shows `Reading N receipt(s)…`, calls `extract-pending` until `remaining` is 0 or a call fails, then `router.refresh()`. It renders nothing when the count is 0.

- [ ] **Step 1: Write the failing integration test** — `receipts-process.check.mjs`, real Supabase, real S3, real Claude (needs `ANTHROPIC_API_KEY` in `.env.local`; when missing, print `SKIP: no ANTHROPIC_API_KEY` and exit 1). It works on the owner's two `IMG_9420.jpeg` rows: select `file_name = 'IMG_9420.jpeg'` ordered by `uploaded_at`, and call them `ID_5F0E` (first) and `ID_1695` (second). Fail if there are not exactly two. It first resets both to `pending` with all extracted fields and `duplicate_of` null, then:

```js
const a = await processReceipt(ID_5F0E)   // uploaded first
const b = await processReceipt(ID_1695)
assert(a.status === 'parsed' && b.status === 'parsed')
const A = await getReceipt(ID_5F0E), B = await getReceipt(ID_1695)
assert(A.purchased_at === '2026-10-21' && A.purchased_time === '20:23:38')
assert(Number(A.total) === 48.6 && Number(A.vat_amount) === 7.41)
assert(A.receipt_number === '614461')
assert(A.vendor.includes('גם סטוק'))
assert(A.duplicate_of === null && B.duplicate_of === ID_5F0E)
// reviewed is never overwritten
await updateReceipt(ID_5F0E, { vendor: 'Owner edit', parse_status: 'reviewed' })
assert((await processReceipt(ID_5F0E)).status === 'skipped')
assert((await getReceipt(ID_5F0E)).vendor === 'Owner edit')
// a model failure becomes an error row, not a crash
const failing = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } }
await updateReceipt(ID_1695, { parse_status: 'pending', duplicate_of: null })
assert((await processReceipt(ID_1695, { client: failing })).status === 'error')
assert((await getReceipt(ID_1695)).parse_error === 'Model refused')
```

At the end, reset both rows to `pending` with empty fields, so the admin page sweep processes them for the owner.

- [ ] **Step 2: Run** → FAIL (module not found). **Step 3: Implement** `processReceipt`, the two routes, the `after()` call, `PendingSweeper`, and the Retry button. **Step 4: Run** → `PASS`.
- [ ] **Step 5: Browser check** (admin cookie): open `/admin/receipts` for October 2026 → `Reading 2 receipts…` → the rows fill in → the second `IMG_9420.jpeg` row is greyed with `Duplicate`. The summary shows `1 receipt · ₪48.60 · VAT ₪7.41`. Click **Not a duplicate** → the row is no longer greyed and the summary counts it.
- [ ] **Step 6: Upload check:** upload a new photo through the Receipt button on `/`, wait 15 s, then reload the admin page → the row shows `parsed` without a sweep (if `after()` works locally) or `Reading 1 receipt…` (if not). Either is correct. Record which one in the ledger.
- [ ] **Step 7: Build and lint** → exit 0, no new lint problems.
- [ ] **Step 8: Commit** — `Read receipts with Claude after upload and from the admin page`.

---

### Task 10: Production check (owner)

- [ ] **Step 1:** The owner adds `ANTHROPIC_API_KEY` to the Amplify environment variables for the `main` branch, then redeploys.
- [ ] **Step 2:** After the merge and deploy, the owner opens **Receipts** in the production admin, and checks the October rows, the CSV in Excel (Hebrew readable, one cell per field), and the ZIP contents.
- [ ] **Step 3:** The owner uploads one new receipt from a phone. Within a minute, or on the next admin page load, its fields fill in.
