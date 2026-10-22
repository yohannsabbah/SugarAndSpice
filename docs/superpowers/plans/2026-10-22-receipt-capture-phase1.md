# Receipt Capture — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An employee taps a **Receipt** button on `/` or `/employee`, takes or picks a photo, and sees **Done**. The photo is stored in S3 and recorded in a `receipts` table with status `pending`.

**Architecture:** The browser downscales the photo to JPEG, hashes the original file, asks the server for a presigned S3 PUT URL, and uploads directly to S3. The browser then tells the server the upload finished. The server confirms the object with `HeadObject` and inserts the row. A duplicate hash short-circuits to **Done** with no upload.

**Tech Stack:** Next.js 16.2.6 App Router (plain JS), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (already installed), Supabase JS client. No new dependencies. No test framework in this repo: verification is plain Node scripts under `scripts/verify/`, the same as the earlier plans.

**Spec:** `docs/superpowers/specs/2026-10-21-receipt-capture-design.md` — Phase 1 only (sections 1 and 2, the `receipts` table, and the first two routes). No OCR. No admin page.

## Revision — 2026-10-22: upload through the server

The owner rejected the direct browser-to-S3 upload. This revision supersedes the
plan text below wherever they disagree:

- One route, `POST /api/receipts`, takes `multipart/form-data` fields `photo` (the
  downscaled JPEG), `sha256`, `fileName`, and optional `employeeId`. It returns
  `200 { id }` for a new photo **and** for a duplicate. It returns `400 { error }`
  for a missing photo, a bad hash, a photo over 4 MB, or bytes that are not a JPEG.
- `/api/receipts/upload-url` is deleted. There are no presigned URLs, no
  `HeadObject` check, and no S3 CORS requirement. The server writes the object with
  `PutObjectCommand`, then inserts the row.
- `MAX_RECEIPT_BYTES` is 4 MB (Amplify request body limit). `isReceiptKey` and
  `keyMatchesHash` are removed. `isJpeg(bytes)` is added.
- Route verification: `scripts/verify/receipts-route.check.mjs` against
  `npm run dev`. `RECEIPTS_DB=skip` runs only the validation cases.

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before writing a route handler. This Next.js version has breaking changes (AGENTS.md).
- S3 key format: `receipts/{MM}_{YYYY}/{timestamp}-{sha8}.jpg`. `MM` is zero-padded. Month and year come from the **upload** time in the `Asia/Jerusalem` time zone, not UTC.
- Images go to the existing bucket `TV_S3_BUCKET`, with the existing `TV_S3_ACCESS_KEY_ID` / `TV_S3_SECRET_ACCESS_KEY`. Do not rename these variables.
- Downscale: long edge 1600 px, never upscale, JPEG quality 0.8.
- The SHA-256 is computed from the **original** file bytes, as 64 lowercase hex characters.
- The employee sees only three states on the button: the idle label **Receipt**, **Uploading…**, and **Done**. On failure: an error line and **Try again**. A duplicate shows **Done**, never a notice.
- The button is on `/` and `/employee` only. It is **not** in the root layout (which also wraps `/admin` and `/tv`).
- The employee-facing routes have no authentication, the same as `/api/shifts/*`.
- The server never inserts a row for an object that `HeadObject` cannot find.
- Upload size cap: 5 MB after downscale, enforced by signing `ContentLength` into the presigned URL.

## Review Focus

1. **Month boundary at night.** A receipt uploaded at 01:30 on 1 November in Israel is still 31 October in UTC. Expected: the key goes in `11_2026`. Pinned in Task 2's key test.
2. **The same photo, picked twice.** Expected: the second attempt shows **Done**, creates no second row, and does not upload. Pinned in Task 3's DB test and Task 4's route check.
3. **The network drops after the S3 PUT, before the record call.** Expected: the employee sees an error and **Try again**. A retry succeeds without a new photo. Pinned in Task 6's manual check.
4. **An iPhone photo (HEIC, or rotated by EXIF).** Expected: the stored JPEG is upright and readable. Pinned in Task 7's real-device check.
5. **The employee opens the picker and then cancels it.** Expected: the button stays at **Receipt**, with no error. Pinned in Task 6's manual check.

---

## File Structure

**Create:**
- `src/lib/s3.js` — shared S3 client factory and bucket lookup.
- `src/lib/receipts/keys.js` — pure key and hash helpers, shared by both routes.
- `src/lib/receipts/prepareImage.js` — browser helpers: size math, downscale, SHA-256.
- `src/lib/storageKeys.js` — the `localStorage` key for the last employee.
- `src/lib/db/receipts.js` — find by hash, create.
- `src/app/api/receipts/upload-url/route.js`
- `src/app/api/receipts/route.js`
- `src/components/ReceiptButton.js`
- `scripts/verify/receipts-keys.check.mjs`
- `scripts/verify/receipts-image.check.mjs`
- `scripts/verify/receipts-db.check.mjs`
- `scripts/verify/receipts-s3.check.mjs`

**Modify:**
- `supabase-finance-schema.sql` — the `receipts` table.
- `src/lib/tv-storage.js` — import the client from `src/lib/s3.js`.
- `src/app/page.js` — place the button.
- `src/app/employee/page.js` — place the button beside "Switch user", and import the storage key.
- `src/app/globals.css` — `.top-actions` and the button states.

---

### Task 1: Shared S3 client, and proof that the credentials reach `receipts/`

The existing IAM credentials may be scoped to the `tv/` prefix only. This task finds that out before any UI depends on it.

**Files:**
- Create: `src/lib/s3.js`
- Modify: `src/lib/tv-storage.js`
- Test: `scripts/verify/receipts-s3.check.mjs`

**Interfaces:**
- Produces: `s3Client(): S3Client`, `s3Bucket(): string`, `S3_REGION = 'us-east-1'`. Both throw the same messages `tv-storage.js` throws today when an env var is missing.
- `tv-storage.js` keeps its exports `tvS3Client`, `TV_S3_REGION`, `TV_S3_KEY`, `readTvMedia`, `writeTvMedia` unchanged. `tvS3Client` becomes an alias for `s3Client`.

- [ ] **Step 1: Write the check script**

`scripts/verify/receipts-s3.check.mjs` imports `s3Client` and `s3Bucket` from `@/lib/s3`. It does the following, in order:
1. Write the key `receipts/00_0000/verify-<Date.now()>.txt` with `PutObjectCommand`, body `'ok'`.
2. Read it back with `HeadObjectCommand`. Assert `ContentLength === 2`.
3. Presign a `PutObjectCommand` for a second key with `ContentType: 'image/jpeg'` and `ContentLength: 3`. `fetch` PUT the bytes `'abc'` with header `Content-Type: image/jpeg`. Assert `res.ok`.
4. Presign the same command shape with `ContentLength: 3`, then PUT 4 bytes. Assert `!res.ok` (this proves the size cap works).
5. Delete both objects with `DeleteObjectCommand`. If the delete fails with `AccessDenied`, print `WARN: no DeleteObject permission — remove receipts/00_0000/ by hand` and do not fail.

Print `PASS` and exit 0 at the end. On any assertion failure, print `FAIL <step>: <reason>` and exit 1.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-s3.check.mjs`
Expected: FAIL — module `@/lib/s3` not found.

- [ ] **Step 3: Create `src/lib/s3.js` and point `tv-storage.js` at it**

Move the client construction and the bucket lookup out of `tv-storage.js`. Keep `import 'server-only'` at the top of both files.

- [ ] **Step 4: Run it to verify it passes**

Run: the command from Step 2.
Expected: `PASS`. **If step 1 or 3 fails with `AccessDenied`, stop.** The IAM policy needs `s3:PutObject` and `s3:GetObject` on `receipts/*`. Report this to the owner. No later task works without it.

- [ ] **Step 5: Confirm the TV feature still works**

Run: `npm run build`
Expected: the build succeeds. Then open `/admin/tv` in `npm run dev` and confirm the media list loads.

- [ ] **Step 6: Commit**

```bash
git add src/lib/s3.js src/lib/tv-storage.js scripts/verify/receipts-s3.check.mjs
git commit -m "Extract shared S3 client for receipts"
```

---

### Task 2: Key and hash helpers

**Files:**
- Create: `src/lib/receipts/keys.js`
- Test: `scripts/verify/receipts-keys.check.mjs`

**Interfaces:**
- Produces (no `server-only`, so plain Node can import it):
  - `receiptS3Key(now: Date, sha256: string): string` → `receipts/MM_YYYY/<now.getTime()>-<sha256.slice(0,8)>.jpg`, with month and year in `Asia/Jerusalem`.
  - `isSha256(value: unknown): boolean` → true only for 64 lowercase hex characters.
  - `isReceiptKey(value: unknown): boolean` → matches `^receipts/\d{2}_\d{4}/\d+-[0-9a-f]{8}\.jpg$`.
  - `keyMatchesHash(key: string, sha256: string): boolean` → true when the 8 characters before `.jpg` equal `sha256.slice(0,8)`.
  - `MAX_RECEIPT_BYTES = 5 * 1024 * 1024`

- [ ] **Step 1: Write the failing test**

`scripts/verify/receipts-keys.check.mjs`, in the same style as `period.check.mjs` (an array of cases, a failure count, exit 1 on failure). Use `H = 'ab'.repeat(32)`.

```js
// receiptS3Key — Israel time, not UTC
[receiptS3Key(new Date('2026-10-31T22:30:00Z'), H), `receipts/11_2026/${Date.parse('2026-10-31T22:30:00Z')}-abababab.jpg`],
[receiptS3Key(new Date('2026-03-05T10:00:00Z'), H).startsWith('receipts/03_2026/'), true],
[receiptS3Key(new Date('2026-12-31T21:59:00Z'), H).startsWith('receipts/12_2026/'), true],
[receiptS3Key(new Date('2026-12-31T22:01:00Z'), H).startsWith('receipts/01_2027/'), true],
// isSha256
[isSha256(H), true],
[isSha256(H.toUpperCase()), false],
[isSha256(H.slice(1)), false],
[isSha256(undefined), false],
// isReceiptKey
[isReceiptKey('receipts/10_2026/1760000000000-abababab.jpg'), true],
[isReceiptKey('receipts/10_2026/../tv/tv-media.json'), false],
[isReceiptKey('tv/1760000000000-abababab.jpg'), false],
// keyMatchesHash
[keyMatchesHash('receipts/10_2026/1-abababab.jpg', H), true],
[keyMatchesHash('receipts/10_2026/1-cdcdcdcd.jpg', H), false],
```

The 31 December cases pin the year rollover. Israel is UTC+2 in winter, so 22:01 UTC is already 1 January.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/receipts-keys.check.mjs`
Expected: FAIL — cannot find `src/lib/receipts/keys.js`.

- [ ] **Step 3: Implement `src/lib/receipts/keys.js`**

Get the month and year from `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now)`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify/receipts-keys.check.mjs`
Expected: `PASS — all 13 cases`

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/keys.js scripts/verify/receipts-keys.check.mjs
git commit -m "Add receipt S3 key and hash helpers"
```

---

### Task 3: `receipts` table and DB functions

**Files:**
- Modify: `supabase-finance-schema.sql`
- Create: `src/lib/db/receipts.js`
- Test: `scripts/verify/receipts-db.check.mjs`

**Interfaces:**
- Produces:
  - `findReceiptByHash(sha256: string): Promise<{ id: string } | null>`
  - `createReceipt({ s3Key, fileName, sha256, uploadedBy }): Promise<{ id: string, created: boolean }>` — `uploadedBy` is a uuid or `null`. When a row with the hash exists, it returns that row's id with `created: false` and changes nothing.

- [ ] **Step 1: Append the table to `supabase-finance-schema.sql`**

Copy the `create table if not exists receipts (...)` block **verbatim** from the spec's "Data model" section. Add, in the same style as the `bank_transactions` section:
- section header `-- 18. receipts — receipt photos captured from the employee screens`
- `receipts_purchased_at_idx` on `(purchased_at)`, `receipts_uploaded_at_idx` on `(uploaded_at)`, `receipts_status_idx` on `(parse_status) where parse_status <> 'reviewed'`
- `enable row level security`, and the `"receipts anon all"` drop-and-create policy

- [ ] **Step 2: Run the new SQL in Supabase**

Ask the owner to paste the new section into the Supabase SQL editor and run it. (The Supabase connector in this session is not authorized, so the agent cannot run it.)
Expected: `Success. No rows returned`.

- [ ] **Step 3: Write the failing test**

`scripts/verify/receipts-db.check.mjs` imports from `@/lib/db/receipts` and `@/lib/supabase`. Use `H = 'f0'.repeat(32)` and the key `receipts/00_0000/1-f0f0f0f0.jpg`.

```js
// start clean
await supabase.from('receipts').delete().eq('image_sha256', H)

assert((await findReceiptByHash(H)) === null)

const a = await createReceipt({ s3Key: KEY, fileName: 'IMG_0001.HEIC', sha256: H, uploadedBy: null })
assert(a.created === true && typeof a.id === 'string')

const b = await createReceipt({ s3Key: KEY, fileName: 'IMG_0001.HEIC', sha256: H, uploadedBy: null })
assert(b.created === false && b.id === a.id)

const found = await findReceiptByHash(H)
assert(found.id === a.id)

const { data: row } = await supabase.from('receipts').select('*').eq('id', a.id).single()
assert(row.parse_status === 'pending' && row.vat_rate == 0.18 && row.currency === 'ILS')

// cleanup
await supabase.from('receipts').delete().eq('id', a.id)
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/receipts-db.check.mjs`
Expected: FAIL — module `@/lib/db/receipts` not found.

- [ ] **Step 5: Implement `src/lib/db/receipts.js`**

Follow `src/lib/db/shifts.js`: `import 'server-only'`, throw the Supabase error. For `createReceipt`, insert, and on Postgres error code `23505` (a unique violation) fall back to `findReceiptByHash`. This handles two uploads of one photo that race each other.

- [ ] **Step 6: Run it to verify it passes**

Run: the command from Step 4.
Expected: `PASS`

- [ ] **Step 7: Commit**

```bash
git add supabase-finance-schema.sql src/lib/db/receipts.js scripts/verify/receipts-db.check.mjs
git commit -m "Add receipts table and DB functions"
```

---

### Task 4: The two API routes

**Files:**
- Create: `src/app/api/receipts/upload-url/route.js`
- Create: `src/app/api/receipts/route.js`

**Interfaces:**
- Consumes: Task 1 `s3Client`, `s3Bucket`. Task 2 `receiptS3Key`, `isSha256`, `isReceiptKey`, `keyMatchesHash`, `MAX_RECEIPT_BYTES`. Task 3 `findReceiptByHash`, `createReceipt`. `getEmployee` from `src/lib/db/employees.js`.
- Produces:
  - `POST /api/receipts/upload-url`, body `{ sha256, size }`.
    - `400 { error }` if `!isSha256(sha256)`, or `size` is not an integer from 1 to `MAX_RECEIPT_BYTES`.
    - `200 { duplicate: true }` if `findReceiptByHash` finds a row.
    - `200 { duplicate: false, url, key }` otherwise. The presigned URL signs `ContentType: 'image/jpeg'` and `ContentLength: size`, and expires in 300 s.
  - `POST /api/receipts`, body `{ key, sha256, fileName, employeeId }`.
    - `400 { error }` if `!isReceiptKey(key)`, `!isSha256(sha256)`, or `!keyMatchesHash(key, sha256)`.
    - `404 { error: 'Upload not found' }` if `HeadObject` returns a 404 (`err.name === 'NotFound'`).
    - `200 { id }` otherwise. `fileName` is trimmed to 200 characters, and becomes `'receipt.jpg'` when it is empty. `employeeId` becomes `uploadedBy` only when `getEmployee` returns an employee. In every other case it is `null`, and the request never fails because of it. Wrap the `getEmployee` call in `try`/`catch`: Supabase throws on a value that is not a uuid (Postgres code `22P02`).
  - Both routes `export const dynamic = 'force-dynamic'`, the same as `api/tv/upload-url`.

- [ ] **Step 1: Implement both routes**

Use `src/app/api/tv/upload-url/route.js` as the model for the presign code. Do not call `isAdmin()`.

- [ ] **Step 2: Verify the rejection paths with curl**

Start `npm run dev`, then run:

```bash
H=$(printf 'abc' | shasum -a 256 | cut -d' ' -f1)
curl -s -XPOST localhost:3000/api/receipts/upload-url -H 'content-type: application/json' -d '{"sha256":"nothex","size":3}'
curl -s -XPOST localhost:3000/api/receipts/upload-url -H 'content-type: application/json' -d "{\"sha256\":\"$H\",\"size\":99999999}"
curl -s -XPOST localhost:3000/api/receipts -H 'content-type: application/json' -d "{\"key\":\"receipts/10_2026/1-${H:0:8}.jpg\",\"sha256\":\"$H\",\"fileName\":\"x.jpg\"}"
curl -s -XPOST localhost:3000/api/receipts -H 'content-type: application/json' -d "{\"key\":\"receipts/10_2026/1-00000000.jpg\",\"sha256\":\"$H\",\"fileName\":\"x.jpg\"}"
```

Expected, in order: `400`, `400`, `404 {"error":"Upload not found"}`, `400`.

- [ ] **Step 3: Verify the full path and the duplicate path with curl**

```bash
R=$(curl -s -XPOST localhost:3000/api/receipts/upload-url -H 'content-type: application/json' -d "{\"sha256\":\"$H\",\"size\":3}")
URL=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).url')
KEY=$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0)).key')
printf 'abc' | curl -s -XPUT -H 'content-type: image/jpeg' --data-binary @- "$URL"
curl -s -XPOST localhost:3000/api/receipts -H 'content-type: application/json' -d "{\"key\":\"$KEY\",\"sha256\":\"$H\",\"fileName\":\"x.jpg\",\"employeeId\":\"not-a-uuid\"}"
curl -s -XPOST localhost:3000/api/receipts/upload-url -H 'content-type: application/json' -d "{\"sha256\":\"$H\",\"size\":3}"
```

Expected: the record call returns `200 {"id":"..."}` (and the bad `employeeId` does not fail it). The last call returns `{"duplicate":true}`. Then delete the test row in the Supabase table editor, and the S3 object if the credentials allow it.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/receipts
git commit -m "Add receipt upload-url and record routes"
```

---

### Task 5: Browser image helpers

**Files:**
- Create: `src/lib/receipts/prepareImage.js`
- Test: `scripts/verify/receipts-image.check.mjs`

**Interfaces:**
- Produces:
  - `scaledSize(width: number, height: number, maxEdge = 1600): { width, height }` — keeps the aspect ratio, rounds to integers, never upscales.
  - `sha256Hex(blob: Blob): Promise<string>` — uses `crypto.subtle.digest('SHA-256', await blob.arrayBuffer())`.
  - `downscaleToJpeg(file: File, { maxEdge = 1600, quality = 0.8 } = {}): Promise<Blob>` — browser only.

- [ ] **Step 1: Write the failing test**

`scripts/verify/receipts-image.check.mjs`. Only the two pure functions run in Node:

```js
[scaledSize(4032, 3024), { width: 1600, height: 1200 }],
[scaledSize(3024, 4032), { width: 1200, height: 1600 }],
[scaledSize(800, 600),   { width: 800,  height: 600 }],
[scaledSize(1600, 1600), { width: 1600, height: 1600 }],
[await sha256Hex(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/receipts-image.check.mjs`
Expected: FAIL — cannot find the module.

- [ ] **Step 3: Implement `src/lib/receipts/prepareImage.js`**

For `downscaleToJpeg`: load the file into an `<img>` through `URL.createObjectURL`, then draw it on a canvas at `scaledSize`, then call `canvas.toBlob(resolve, 'image/jpeg', quality)`. Revoke the object URL afterward. Use an `<img>`, not `createImageBitmap`. Safari decodes HEIC in an `<img>`, and current browsers apply EXIF rotation there by default. Reject the promise if the image fails to load or `toBlob` yields `null`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify/receipts-image.check.mjs`
Expected: `PASS — all 5 cases`

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/prepareImage.js scripts/verify/receipts-image.check.mjs
git commit -m "Add receipt image downscale and hash helpers"
```

---

### Task 6: `ReceiptButton` on both screens

**Files:**
- Create: `src/components/ReceiptButton.js`
- Create: `src/lib/storageKeys.js`
- Modify: `src/app/page.js`
- Modify: `src/app/employee/page.js` (the `STORAGE_KEY` constant at line 7, and the "Switch user" button block)
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 5 `downscaleToJpeg`, `sha256Hex`. The Task 4 routes.
- Produces: `export const LAST_EMPLOYEE_KEY = 'ss_last_employee_id'` in `src/lib/storageKeys.js`. `employee/page.js` imports it in place of its local `STORAGE_KEY`. The behavior is unchanged.
- `<ReceiptButton />` takes no props. It reads `LAST_EMPLOYEE_KEY` from `localStorage` at upload time, inside a `try`/`catch`.

- [ ] **Step 1: Build the component**

A `'use client'` component. It holds a hidden `<input type="file" accept="image/*">` with no `capture` attribute (the owner wants both camera and file options) and a visible `btn btn-ghost` button that opens the input. The visible states are exactly:

| State | Label | Notes |
|---|---|---|
| `idle` | 📷 Receipt | |
| `working` | Uploading… | The button is disabled. |
| `done` | ✓ Done | Returns to `idle` after 2500 ms. |
| `error` | Try again | A short error line shows under the button. A tap retries with the same file and does not open the picker. |

The pipeline: `sha256Hex(file)` → `downscaleToJpeg(file)` → POST `upload-url` with `{ sha256, size: blob.size }` → if `duplicate`, go to `done` → otherwise PUT the blob to `url` with `Content-Type: image/jpeg` → POST `/api/receipts` with `{ key, sha256, fileName: file.name, employeeId }` → `done`.

Keep the selected `File` in a `useRef` so the retry can reuse it. Clear `input.value` after each change, so the employee can pick the same file again. If `onChange` gives no file (the employee cancelled the picker), stay in `idle`.

- [ ] **Step 2: Place it on both screens**

- `src/app/page.js`: add `style={{ position: 'relative' }}` to the container, and render `<div className="top-actions"><ReceiptButton /></div>`.
- `src/app/employee/page.js`: replace the absolutely positioned "Switch user" button with `<div className="top-actions">` holding `<ReceiptButton />` and the "Switch user" button. "Switch user" keeps its current condition (`employeeId && !loading`). The Receipt button always renders.
- `globals.css`: `.top-actions { position: absolute; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 1; }`. Move the "Switch user" inline padding and font size to a shared `.top-actions .btn` rule, so the two buttons match.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, with no new warnings.

- [ ] **Step 4: Check the flows in a desktop browser**

Run `npm run dev`. Open `/` and `/employee` at a 390 px wide viewport in the browser dev tools. Check each item:

1. The **Receipt** button shows on `/`, and on `/employee` before a shift, during a shift, and with no employee picked.
2. The button does not overlap the logo or the "Switch user" button.
3. Pick a large JPEG → **Uploading…** → **Done** → **Receipt**. A new `pending` row appears in Supabase. The object in S3 is under 500 KB.
4. Pick the same file again → **Done**. No second row appears.
5. Open the picker and cancel it → the button stays at **Receipt**.
6. Set the dev tools network to Offline after the PUT request starts → **Try again** with an error line. Go back online and tap **Try again** → **Done**, with no picker.
7. `/tv` and `/admin` show no Receipt button.

If item 3 fails in the browser with a network error, but the Task 1 check passed, the bucket CORS rules block the PUT. Ask the owner to allow `PUT` with header `Content-Type` from the app origins.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReceiptButton.js src/lib/storageKeys.js src/app/page.js src/app/employee/page.js src/app/globals.css
git commit -m "Add Receipt button to home and shift screens"
```

---

### Task 7: Real-device check

No code. This task runs after deployment to the Amplify preview or production. A desktop browser does not exercise these paths.

- [ ] **Step 1: On an iPhone (Safari)**

1. Tap **Receipt** → **Take Photo** → photograph a real receipt → **Done**.
2. Tap **Receipt** → **Photo Library** → pick an existing receipt photo (this is usually HEIC) → **Done**.
3. Download both objects from S3. Expected: both are JPEG, upright, under 500 KB, and the text is readable.

- [ ] **Step 2: On an Android phone (Chrome)**

Repeat step 1, items 1 and 3.

- [ ] **Step 3: Report**

Tell the owner the results, with the S3 keys and the file sizes. If a photo comes out sideways, the EXIF fallback needs work before employees use the button.
