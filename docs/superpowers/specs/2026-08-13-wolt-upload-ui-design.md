# Wolt upload UI — design

Date: 2026-08-13
Status: approved (pending spec review)

## Problem

Wolt data (period invoices, netting reports, sales reports, and monthly CSV
exports) is fully parseable — six working parsers exist in
`src/lib/parsers/wolt/` — but the only way to get that data into Supabase
today is `scripts/backfill-wolt.mjs`, a developer-run Node script pointed at
a local folder. There is no upload form on the Wolt admin page, unlike Nayax
and Expenses which already have full self-serve upload UIs.

Goal: let the owner drop Wolt files into the admin UI (any subset, any
order, any time) and have the app figure out what each file is and where it
belongs, the same way Nayax/Expenses uploads already work.

## Non-goals

- No new UI/DB support for other delivery platforms — Wolt only.
- No raw-file storage. Like the existing Nayax/Expenses upload routes, files
  are parsed in memory and only the extracted data is persisted; the
  original PDF/CSV is discarded after the request. (`documents` table /
  `file_path` tracking, as used by the backfill script, is **not** used by
  this new path.)
- `scripts/backfill-wolt.mjs` is not being retired — it remains the tool for
  bulk historical import from a local folder — but its shared write logic is
  being extracted so the new route doesn't duplicate it.

## Architecture & data flow

One upload surface: a single "Upload Wolt files" card on
`src/app/admin/(dashboard)/wolt/page.js`, with one multi-file dropzone. The
user drops any number of files, any mix of the 6 supported types, in any
order. No month picker, no period picker, no per-type file slots — this is
the key difference from the Nayax upload card, which requires exactly 3
named files for one explicit month.

Flow per submission to `POST /api/admin/wolt/upload`:

1. Each dropped file is classified (see below) into one of: `w2m`, `m2w`,
   `netting`, `sales_report`, `csv_items`, `csv_purchases`, or `unknown`.
2. Files are processed in two waves within the same request:
   - **Wave 1 — period-establishing docs** (`w2m`, `m2w`): each carries
     `periodStart`/`periodEnd` in the PDF text. Compute `period_year` /
     `period_num` from the date and upsert `wolt_periods` (merge-based —
     only non-null incoming fields overwrite existing ones, exactly as
     `backfill-wolt.mjs` does today).
   - **Wave 2 — period-dependent docs** (`netting`, `sales_report`,
     `csv_purchases`): matched to a period via invoice-number
     cross-reference (`netting`/`sales_report`) or per-order date
     (`csv_purchases`) — see Period linking below.
3. `csv_items` is independent of periods entirely — keyed only by calendar
   month, extracted from the filename.
4. Response is a per-file result list, not one pass/fail for the whole
   batch — see Response shape below.

## Classification

Reuses the existing parsers directly; no new detection code beyond a
dispatcher function.

**PDF** — run the file's text through parsers in this order, taking the
first confidence signal that fires:

1. `parseNetting` → non-null `nettingNo`
2. `parseSalesReport` → at least one order row found
3. `parseMerchantToWolt` → non-null `grossSalesInclVat`
4. `parseWoltToMerchant` → at least one fee line, or non-null `totalInclVat`

Order matters: netting and sales-report signals are the most specific and
checked first to avoid false positives against the two invoice types, which
share a similar header structure.

If none match, classify as `unknown` and report an error for that file
without affecting the rest of the batch.

**CSV** — read the header row only:
- `Item name` + `Quantity` + `Total` columns present → `csv_items`
- `Order placed` + `Order number` columns present → `csv_purchases`
- Neither → `unknown`

## Period linking

- `w2m` / `m2w`: `periodStart`/`periodEnd` → `period_year`/`period_num`
  (same `periodNumForDate`-style logic as the backfill script). Upsert
  `wolt_periods`.
- `netting`: carries `woltInvoiceNo` + `merchantInvoiceNo`, no date. Look up
  `wolt_periods` where `wolt_invoice_no` or `merchant_invoice_no` matches —
  checking both periods already in the DB **and** periods established
  earlier in the same upload batch (wave 1 results held in memory for the
  duration of the request). No match → per-file error: `"No matching period
  found — upload the Wolt→Merchant and Merchant→Wolt invoices for this
  period too."` File is skipped; batch continues.
- `sales_report`: same lookup, keyed on `merchantInvoiceNo` only.
- `csv_purchases`: no period lookup needed for classification — each row
  carries its own `placed_at`. Group rows by computed period per-row
  (`periodNumForDate`); any group whose period isn't found gets the same
  per-group error, listing which period-dates are missing. Groups with a
  found period still import normally.
- `csv_items`: no period lookup — keyed only by calendar month via filename
  pattern `items_YYYY-MM-DD_...`. Filename that doesn't match this pattern →
  error asking for a correctly-named file (no silent guessing).

## Idempotency

Re-uploading the same or a corrected file is always safe:
- Periods: merge-upsert, keyed on `(period_year, period_num)`.
- Fees / deductions / orders / order-items / period-items: full
  delete-and-replace scoped to the period or month being touched.

This matches `backfill-wolt.mjs`'s existing behavior exactly.

## Data written (no new tables)

All target tables already exist in `supabase-finance-schema.sql`:
`wolt_periods`, `wolt_period_fees`, `wolt_deductions`, `wolt_orders`,
`wolt_order_items`, `wolt_period_items`, `items` (shared catalog, also
written to by the Nayax pipeline).

## Code organization

Extract the write logic currently inline in `scripts/backfill-wolt.mjs`
(period upsert with merge, fee/deduction replace, item upsert + category
inference rules) into `src/lib/db/wolt.js`, matching the existing
`db/nayax.js` / `db/expenses.js` pattern. Both the backfill script and the
new API route import from there — no duplicated upsert logic between the
one-off bulk-import tool and the live upload path.

New files:
- `src/lib/parsers/wolt/classify.js` — the classification dispatcher
  described above (PDF + CSV).
- `src/lib/db/wolt.js` — extracted shared write functions.
- `src/app/api/admin/wolt/upload/route.js` — the upload endpoint.
- `src/app/admin/(dashboard)/wolt/UploadCard.js` — the dropzone UI,
  following the existing `UploadCard.js` component shape used by
  Nayax/Expenses (client component, `FormData`, `fetch`, result banner).

Modified files:
- `scripts/backfill-wolt.mjs` — same behavior, now calling into
  `src/lib/db/wolt.js` instead of inlining the Supabase writes.
- `src/app/admin/(dashboard)/wolt/page.js` — render the new `UploadCard`.

## Response shape

```json
{
  "results": [
    { "filename": "WOLT_TO_MERCHANT_INVOICE_...pdf", "detected_type": "w2m", "status": "ok", "detail": "Period 2026-P9 updated" },
    { "filename": "NETTING_REPORT_...pdf", "detected_type": "netting", "status": "error", "detail": "No matching period found — upload the Wolt→Merchant and Merchant→Wolt invoices for this period too" },
    { "filename": "weird-file.pdf", "detected_type": "unknown", "status": "error", "detail": "Unrecognized file — not a known Wolt PDF or CSV" }
  ]
}
```

The UI renders this as a checklist (✓ / ✗ per file with its detail message),
not a single batch-level pass/fail — following the existing per-check
display pattern already used in the Nayax `UploadCard`'s reconciliation
banner.

## Auth

Same as every other admin upload route: `isAdmin()` check from
`src/lib/admin.js`, 401 if not authenticated.

## Testing

- Unit-test `classify.js` against the existing sample files already used to
  develop the six parsers (periods 7–10 in `../data/wolt/2026`), asserting
  each file is classified correctly.
- Manual end-to-end pass: upload a full period's 4 PDFs plus that month's 2
  CSVs through the new dropzone, confirm the Wolt dashboard page reflects
  the new period identically to what the backfill script produces for the
  same source files.
- Re-upload the same files a second time, confirm no duplicate rows (fees,
  deductions, orders, items) — merge/replace idempotency check.
