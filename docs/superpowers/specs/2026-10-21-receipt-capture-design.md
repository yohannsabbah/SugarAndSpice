# Receipt capture and monthly accountant export — design

Date: 2026-10-21
Status: proposed

## Why

Employees buy supplies during a shift. They photograph the paper receipt and send
the photo to WhatsApp. WhatsApp is not a system of record. The owner cannot
extract the photos. The owner cannot total them. The paper receipt is often lost
before anyone files it.

The owner sends receipts to an external accountant every month. Today that handoff
is manual and incomplete. The owner also has no way to check the accountant's work,
because the owner holds no authoritative list of what was spent.

This feature moves the receipt out of WhatsApp and into the app.

## Phases

The owner set this order. Each phase ships on its own.

1. **Capture and storage.** The button, the camera, the downscale, the S3 upload, and
   the `receipts` row. Sections 1 and 2 below, plus the table and the first two
   routes. Rows stay in status `pending` at the end of this phase. Nothing reads them
   yet, but no receipt is lost from this point on.
2. **Extraction.** The AI call that fills the fields. Sections 3 and 4.
3. **Review and export.** The admin page, the CSV, and the ZIP. Sections 5 and 6.

Phase 1 is the only one that changes employee behavior, so it delivers value first:
the photos stop going to WhatsApp. Phases 2 and 3 can then process every receipt
captured since phase 1 shipped.

## Goals

1. **Capture.** An employee photographs a receipt from the app in two taps. The
   image reaches durable storage immediately.
2. **Extract.** An AI reads the image and fills in the date, the vendor, the total,
   and the receipt number. A human corrects it later if the AI is wrong.
3. **Export a ZIP.** The owner downloads every receipt image for a chosen month as
   one archive, and sends it to the accountant.
4. **Export a CSV.** The owner downloads one row per receipt for that month, with
   the amount and the VAT, and sends it with the ZIP.
5. **Audit.** The owner compares the accountant's books against this list and finds
   the receipts the accountant missed.

## Non-goals

- No line-item extraction. The feature does not read individual products.
- No per-item price history. No supplier price comparison.
- No link to the `expenses` table from credit-card statements. The two data sets
  stay separate in this version.
- No reimbursement tracking. The feature does not record who owes whom money.
- No approval workflow. An employee uploads. Nothing blocks the upload.

## Anti-goals

These outcomes make the feature a failure even if the code works:

- **A silent data loss.** An employee taps the button, sees a success message, and
  the image never reaches S3. The paper receipt is then thrown away. The record is
  gone forever. Upload confirmation must follow the stored object, not precede it.
- **An unverifiable number.** A row shows ₪147.50 and the owner cannot check it
  against the picture. Every row must link to its image for the life of the row.
- **A hostile capture step.** The employee must not type anything, choose a
  category, or wait for the AI. If capture takes longer than WhatsApp, employees
  keep using WhatsApp.

## Constraints

- **Next.js 16.2.6.** This version carries breaking changes. Read the relevant
  guide in `node_modules/next/dist/docs/01-app/` before writing any route handler
  or page. Check `01-app/02-guides/upgrading/version-16.md` for deprecations.
- **Existing stack only where possible.** Supabase for data. S3 for files. The app
  uses plain JavaScript, not TypeScript. No CSS framework. Styling uses the global
  classes already in `src/app/layout.js` and the existing `card` / `btn` / `stack`
  conventions.
- **Mobile first.** The capture screen runs on an employee's phone, often on mobile
  data, often one-handed.
- **Hebrew.** Vendor names and receipt text are mostly Hebrew. Every export must
  survive the round trip into the accountant's tools.

## The flow

### 1. Capture

A **Receipt** button sits in the top-right corner of the screen, with a camera icon.
It is always visible on two screens:

- the home screen at `/` ([src/app/page.js](../../../src/app/page.js))
- the shift screen at `/employee` ([src/app/employee/page.js](../../../src/app/employee/page.js)),
  before, during, and after a shift

Build it once as a shared client component, `src/components/ReceiptButton.js`, and
place it on both pages. Do not put it in the root layout, because that layout also
wraps `/admin` and `/tv`, and the TV screen must not show it.

The shift screen already has a "Switch user" button in its top-right corner. Place
the two buttons side by side there. The exact arrangement is the builder's call.

The button is a file input with `accept="image/*"` and `capture="environment"`. On a
phone this offers the camera and the photo library. The employee does not need an
open shift to use it.

The employee sees nothing about receipts except this button and the result of an
upload. The list of receipts exists only on the admin page.

After the employee picks the image:

1. The browser downscales the image to a 1600px long edge and re-encodes it as JPEG
   at quality 0.8. This cuts a 4 MB phone photo to roughly 300 KB. It keeps enough
   detail for OCR. It makes the upload finish on mobile data.
2. The browser computes a SHA-256 of the **original** file with `crypto.subtle`.
   Hash the original, not the downscaled output, so the same photo picked twice from
   the library always produces the same hash.
3. The browser asks the server for a presigned S3 PUT URL, sending the hash.
   If a row with that hash exists, the server says so, and the browser skips to
   step 7. The employee is not told it was a duplicate.
4. The browser uploads directly to S3.
5. The browser tells the server the upload finished.
6. The server confirms the object exists with an S3 `HeadObject` call, then creates
   the `receipts` row with status `pending`, then returns. This check enforces the
   first anti-goal: the server never records a receipt it cannot see in S3.
7. The employee sees **Done**. Nothing else: no thumbnail, no extracted numbers,
   no duplicate notice.

If any step fails, the employee sees an error and a **Try again** button. The
selected image stays in memory, so a retry does not need a second photo.

**iPhone images.** The photo library on iOS may hand the browser a HEIC file. Safari
decodes HEIC into a canvas, so the downscale step also converts it to JPEG. Test
this path on a real iPhone, because a desktop browser does not exercise it.

**S3 CORS.** A direct browser PUT needs the bucket CORS rules to allow `PUT` from
the app origin. The TV upload already does a browser PUT from the admin page, so the
rules likely allow it. Confirm before testing, because the failure looks like a
network error in the browser and says nothing about CORS.

The employee never waits for the AI. Extraction runs after the response.

The employee may upload several receipts in a row. The button stays on screen.

**Identity.** The home screen reads `ss_last_employee_id` from `localStorage`, the
same key [src/app/employee/page.js](../../../src/app/employee/page.js) already
writes. If the key holds a known employee, the row records who uploaded. If not,
the row records nothing. The upload never blocks on identity.

### 2. Storage

Images go to the existing S3 bucket (`TV_S3_BUCKET`) under:

```
receipts/{MM}_{YYYY}/{timestamp}-{slug}.jpg
```

`MM` and `YYYY` come from the **upload** date, because the purchase date is unknown
at the moment the presigned URL is issued.

**The folder is not the authority.** The `receipts` table decides which month a
receipt belongs to, using the purchase date the AI read. A receipt bought on
31 October and photographed on 1 November sits in the `11_2026` folder but exports
with October. The ZIP export reads the database and fetches each object by its
stored key, so the folder never affects the export.

If the owner later wants the folder to always match the purchase month, the builder
can add a copy-and-delete step after extraction. That is not in this version.

The existing S3 helper is [src/lib/tv-storage.js](../../../src/lib/tv-storage.js).
Its client factory and credentials are reusable, but its name and its `TV_*`
environment variables are specific to the TV feature. Rename the shared parts into
`src/lib/s3.js` and leave `tv-storage.js` importing from it. Keep the existing
`TV_S3_*` variable names so the deployment does not break.

### 3. Extraction

A server route reads the object back from S3 and sends it to Claude as a vision
request.

- SDK: `@anthropic-ai/sdk` (new dependency).
- Model: `claude-haiku-5-5`. The owner chose a low-cost model, because the task
  reads five fields from one image.
- Thinking: omit the parameter. Thinking is always on for this model.
- Effort: `output_config.effort` of `medium`. Tune after the first real receipts.
- `max_tokens`: 2000. The output is a small JSON object.
- Structured output: `output_config.format` with a JSON schema, so the response
  parses without string handling.
- Credentials: `ANTHROPIC_API_KEY` in the environment.

Fields the model returns:

| Field | Type | Notes |
|---|---|---|
| `purchased_at` | date or null | The date printed on the receipt. |
| `vendor` | string or null | The business name, as printed. |
| `total` | number or null | The grand total the customer paid. |
| `receipt_number` | string or null | The receipt or invoice number. |
| `currency` | string | `ILS` unless the receipt says otherwise. |
| `confidence` | `high` / `low` | The model's own read on whether the image was legible. |

Every field is nullable. A blurred photo returns nulls rather than guesses. The
prompt must say so explicitly, because a confident wrong total is worse than an
empty cell.

On success the row moves to status `parsed`. On failure it moves to `error` and
keeps the error text. A failed extraction never loses the image.

The extraction route is also callable by hand, so the owner can retry one receipt
from the admin page.

**Read `shared/model-migration.md` and the TypeScript tool-use guide from the
`claude-api` skill before writing this call.** The structured-output parameter shape
changed recently. Do not write it from memory.

### 4. VAT

Israeli VAT is 18%. Receipt totals include it.

```
vat_amount = round(total * 0.18 / 1.18, 2)
net_amount = total - vat_amount
```

The feature does not read the VAT line off the receipt. It derives VAT from the
total, on the owner's instruction.

Store `vat_rate` on every row. Store the computed `vat_amount` rather than deriving
it on read. A past month must keep exporting the same numbers after the rate changes.

Recompute `vat_amount` whenever the total changes, including when the owner edits it.

### 5. Review and correction

A new admin page at `/admin/receipts`, inside the `(dashboard)` group, next to the
existing expenses and shifts pages.

The page shows one month at a time. Reuse
[src/components/MonthPicker.js](../../../src/components/MonthPicker.js) and
[src/components/AdminMonthPickerSlot.js](../../../src/components/AdminMonthPickerSlot.js),
as the other admin pages do.

The table lists every receipt whose effective month matches, one row each:

| Column | Editable | Notes |
|---|---|---|
| Thumbnail | no | Opens the full image. Served by a short-lived presigned GET URL. |
| Date | yes | The purchase date. Drives which month the row exports with. |
| Vendor | yes | |
| Receipt no. | yes | |
| Amount | yes | Editing it recomputes VAT. |
| VAT | no | Derived. Shown so the owner can sanity-check it. |
| Uploaded by | no | The employee name, or a dash. |
| Status | no | `pending`, `parsed`, `error`, or `reviewed`. |

Rows the AI could not read sort to the top, so the owner fixes them first.

Editing a field saves it immediately and marks the row `reviewed`. The owner can
also delete a row. Deleting a row keeps the S3 object, so a mistaken delete is
recoverable.

Above the table sit two buttons: **Download CSV** and **Download all receipts (ZIP)**.
Both act on the month currently shown.

Also show a small summary above the table: the receipt count, the total, and the
total VAT for the month. That is the number the owner checks against the accountant.

### 6. Export

**CSV.** One row per receipt, built by hand. No dependency.

Columns: `date`, `vendor`, `receipt_number`, `amount`, `vat_rate`, `vat_amount`,
`net_amount`, `uploaded_by`, `image_file`.

`image_file` holds the same filename the ZIP uses, so the accountant can match a
spreadsheet row to a picture.

**The CSV must start with a UTF-8 byte order mark (`﻿`).** Without it, Excel
on Windows renders Hebrew vendor names as mojibake, and the accountant cannot read
the file. Quote every field that may contain a comma or a quote.

**ZIP.** Add the `archiver` dependency and stream the archive to the response, so a
month with 200 images does not load into memory at once.

Each entry is named for a human:

```
2026-10-03_רמי-לוי_147.50_a1b2c3d4.jpg
```

Date, vendor, amount, and a short id. The id keeps two receipts from the same vendor
on the same day for the same amount from colliding.

Include the CSV inside the ZIP as well, so one file carries the whole handoff.

## Data model

One new table. Add it to `supabase-finance-schema.sql`, following the conventions
already in that file: `uuid` primary key, `timestamptz` audit columns, RLS enabled
with a permissive `anon all` policy, idempotent statements.

```sql
create table if not exists receipts (
  id                uuid primary key default gen_random_uuid(),

  -- storage
  s3_key            text not null,
  file_name         text not null,
  image_sha256      text not null unique,   -- blocks a double upload of one photo

  -- provenance
  uploaded_at       timestamptz not null default now(),
  uploaded_by       uuid references employees(id) on delete set null,

  -- extracted, all nullable: a blurred photo yields nothing
  purchased_at      date,
  vendor            text,
  receipt_number    text,
  total             numeric(12,2),
  currency          text not null default 'ILS',

  -- derived
  vat_rate          numeric(5,4) not null default 0.18,
  vat_amount        numeric(12,2),

  -- lifecycle
  parse_status      text not null default 'pending',  -- pending | parsed | error | reviewed
  parse_error       text,
  parsed_at         timestamptz,
  reviewed_at       timestamptz,
  ai_confidence     text,                             -- high | low
  raw_extraction    jsonb,                            -- what the model returned, verbatim

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

Indexes: one on `purchased_at` for the month query, one on `parse_status` for the
unreviewed rows, one on `uploaded_at` as the fallback month key.

**The effective month.** A row belongs to the month of `purchased_at` when that
column holds a value, and to the month of `uploaded_at` when it does not. Both the
page query and the two exports must use the same rule. Put the rule in one place in
`src/lib/db/receipts.js` so the three callers cannot drift apart.

**Duplicate uploads.** `image_sha256` is unique. A second upload of the same bytes
returns the existing row instead of creating a new one. The employee still sees
**Done**, the same as for a new receipt.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/receipts/upload-url` | POST | Check the hash for a duplicate. Issue a presigned PUT URL. Public, like the shift routes. |
| `/api/receipts` | POST | Verify the object with `HeadObject`. Create the row. |
| `/api/receipts/[id]/extract` | POST | Run the AI. Called after create and on manual retry. |
| `/api/admin/receipts/[id]` | PATCH, DELETE | Edit or delete a row. Admin only. |
| `/api/admin/receipts/export.csv` | GET | The month's CSV. Admin only. |
| `/api/admin/receipts/export.zip` | GET | The month's ZIP. Admin only. |

The employee-facing routes carry no authentication, matching the existing
`/api/shifts/*` routes. The admin routes use `isAdmin()` from
[src/lib/admin.js](../../../src/lib/admin.js), matching the existing admin routes.

## Decisions made for the builder

These were not specified by the owner. The builder may revisit them, but they are
settled for this version:

1. **A separate `receipts` table**, not a reuse of `documents` or `expenses`. The
   purpose is an accountant handoff, not P&L.
2. **Client-side downscale before upload.** An employee on mobile data will abandon
   a 4 MB upload.
3. **Extraction runs after the upload response**, not during it. Capture speed is an
   anti-goal if it is slow.
4. **The S3 folder uses the upload month**, with the database as the authority for
   the export month. Explained above.
5. **Effort `medium`** on `claude-haiku-5-5` (the owner chose the model). If the
   first real receipts come back with wrong totals, raise the effort before you
   change the model.
6. **Deleting a row keeps the S3 object.** Losing a receipt is the thing this
   feature exists to prevent.
7. **The CSV ships inside the ZIP too.** One attachment is easier to email than two.

## Left to the builder

- The exact prompt text for the extraction call, and its JSON schema.
- Table layout and the inline-edit interaction on the admin page.
- How the thumbnail is rendered, and how long the presigned GET URL lives.
- Whether the retry of a failed extraction is a per-row button, a bulk action, or
  both.
- Error copy on the capture screen.

## Open risks

1. **OCR accuracy on thermal paper.** A faded or creased receipt may be unreadable.
   The design handles this with nullable fields and a review step, but if most
   receipts come back empty, the AI step is not earning its cost. Measure on the
   first fifty real receipts before building anything further on top of it.
2. **The S3 bucket is shared with the TV media feature.** The `receipts/` prefix
   keeps them apart, but the bucket's access policy now covers business financial
   records. Confirm the bucket is private before the first real receipt lands.
3. **No authentication on the capture route.** Anyone who reaches the home screen
   can upload an image. That matches the existing shift routes, and the blast radius
   is a junk row an admin deletes. It is worth stating out loud rather than
   discovering later.
