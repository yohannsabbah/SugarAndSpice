# Bank Statement Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner upload a Bank Hapoalim "current account operations" PDF and see a monthly view of money in/out by category, per the design in `docs/superpowers/specs/2026-08-14-bank-statement-ingestion-design.md`.

**Architecture:** A single-file upload (one PDF, any date range) hits a new API route that parses transactions via balance-delta debit/credit inference (already validated against the real sample file — see below), categorizes each row by description, and upserts into one new table with hash-based dedup. A new `/admin/bank` page shows KPIs, an outflow-by-category breakdown (the owner's stated priority), an inflow-by-category breakdown, and a plain transaction list, scoped to the shared month picker.

**Tech Stack:** Same as the Wolt feature — Next.js App Router, `pdf-parse` via the existing `pdfText()` helper, Supabase JS client. No test framework in this repo — verification is plain Node scripts under `scripts/verify/`, run against the real sample file already confirmed to exist at `~/Downloads/current_account_operations_10.08.2026_14.48.03.pdf`.

## Global Constraints

- `bank_transactions` is a flat, self-contained table — no parent "statement"/"document" record, unlike Wolt's periods or Expenses' `expense_documents`.
- Dedup is a single global unique constraint on `source_row_hash` (sha256 of date|description|amount|balance_after, truncated to 16 hex chars) — same hashing pattern as `rowHash` in `src/lib/db/expenses.js`, applied via `.upsert(rows, { onConflict: 'source_row_hash', ignoreDuplicates: true })`.
- `amount` is stored **signed**: positive = credit/inflow, negative = debit/outflow.
- No manual per-transaction tagging/notes in this pass — confirmed out of scope with the owner.
- The `/admin/bank` page defaults to the **current calendar month** when no `?month=` param is present (matching the fix already applied to the Wolt page for the same reason — the shared `MonthPicker`'s "this month" button removes the param entirely).

---

## File Structure

**Create:**
- `src/lib/parsers/bank/parseHapoalimStatement.js` — the parser.
- `src/lib/db/bank.js` — insert (dedup) + the single read function the page needs.
- `src/app/api/admin/bank/upload/route.js` — upload endpoint.
- `src/app/admin/(dashboard)/bank/page.js`, `UploadCard.js`, `bank.css`.
- `scripts/verify/bank-parse.check.mjs` — runs the parser against the real sample file.
- `scripts/verify/bank-db.check.mjs` — runs `insertBankTransactions` + the read function against the real dev Supabase project.

**Modify:**
- `supabase-finance-schema.sql` — new `bank_transactions` table.
- `src/components/AdminMonthPickerSlot.js` — add `/admin/bank` to `PATHS_WITH_MONTH`.
- `src/app/admin/(dashboard)/layout.js` — add a nav link.

---

### Task 1: SQL migration

**Files:**
- Modify: `supabase-finance-schema.sql`

- [x] **Step 1: Add the table definition**

Append to `supabase-finance-schema.sql` (anywhere after the existing table definitions, e.g. right before the RLS section):

```sql
------------------------------------------------------------------------
-- N. bank_transactions — parsed from Bank Hapoalim PDF statement exports
------------------------------------------------------------------------
create table if not exists bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  txn_date          date not null,
  description       text not null,          -- raw, as printed in the statement
  amount            numeric(12,2) not null, -- signed: + credit/inflow, - debit/outflow
  balance_after     numeric(12,2),
  category          text not null,
  footnote_code     text,                   -- raw '1'/'2' marker from the source; meaning unestablished, unused
  source_row_hash   text not null unique,   -- sha256(date|description|amount|balance_after), truncated
  created_at        timestamptz not null default now()
);

create index if not exists bank_transactions_date_idx on bank_transactions (txn_date);
create index if not exists bank_transactions_category_idx on bank_transactions (category);

alter table bank_transactions enable row level security;
drop policy if exists "bank_transactions anon all" on bank_transactions;
create policy "bank_transactions anon all" on bank_transactions
  for all using (true) with check (true);
```

(Match the existing RLS policy style already used for every other table in this file — permissive "anon all," since the app-level PIN login is the real access gate.)

- [ ] **Step 2: Ask the user to run it**

This plan's executor cannot run DDL with the app's publishable key. Tell the user to run the new SQL block in the Supabase SQL editor before continuing to Task 3 (Task 2's DB check will fail with a `42P01` "table does not exist" error otherwise — that's expected and fine to hit once, just don't proceed past it).

- [ ] **Step 3: Commit**

```bash
git add supabase-finance-schema.sql
git commit -m "Add bank_transactions table for bank statement ingestion"
```

---

### Task 2: Parser

**Files:**
- Create: `src/lib/parsers/bank/parseHapoalimStatement.js`
- Create: `scripts/verify/bank-parse.check.mjs`

**Interfaces:**
- Consumes: `pdfText`, `lines`, `fields`, `num` from `src/lib/parsers/wolt/text-utils.js` (already generic, bank-agnostic).
- Produces: `parseHapoalimStatement(buffer: Buffer) -> Promise<{ transactions: Array<{ date: string /* YYYY-MM-DD */, description: string, amount: number /* signed */, balance_after: number, category: string }> }>`, and `inferBankCategory(description: string) -> string` (exported separately so it's unit-testable without a PDF).

- [ ] **Step 1: Write the check script (fails — module doesn't exist yet)**

This test runs against the **real sample file** already confirmed on this machine — no fixture needed, because the whole point of this parser is that it was reverse-engineered against real data (see the design spec's verification numbers: 397/397 rows resolved correctly).

Create `scripts/verify/bank-parse.check.mjs`:

```js
import { parseHapoalimStatement, inferBankCategory } from '../../src/lib/parsers/bank/parseHapoalimStatement.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const SAMPLE_PATH = process.argv[2] ||
  path.join(homedir(), 'Downloads', 'current_account_operations_10.08.2026_14.48.03.pdf')

let failed = 0
function check(label, actual, expected) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

// -- inferBankCategory (pure, no file needed) ------------------------------
check('isracard', inferBankCategory('ישראכרט'), 'card_settlement_isracard')
check('isracard ltd variant', inferBankCategory('ישראכרט בע"מ)'), 'card_settlement_isracard')
check('max', inferBankCategory('מקס איט פיננסי'), 'card_settlement_max')
check('amex', inferBankCategory('אמריקן אקספרס'), 'card_settlement_amex')
check('diners', inferBankCategory('דיינרס קלוב יש'), 'card_settlement_diners')
check('check', inferBankCategory('שיק'), 'check')
check('transfer', inferBankCategory("העב' לאחר-נייד"), 'transfer')
check('national insurance', inferBankCategory('ביטוח לאומי'), 'national_insurance')
check('vat', inferBankCategory('מע"מ'), 'vat')
check('utilities', inferBankCategory('חברת החשמל ליש'), 'utilities')
check('bank fee', inferBankCategory('פנקסי שיקים'), 'bank_fee')
check('unknown falls to other', inferBankCategory('א.ו חללים'), 'other')

// -- full parse against the real file --------------------------------------
const buffer = await readFile(SAMPLE_PATH)
const { transactions } = await parseHapoalimStatement(buffer)

check('transaction count', transactions.length, 397)

// Every transaction's running-balance math must be internally consistent:
// balance_after[i] should equal balance_after[i+1 chronologically-earlier]
// plus this transaction's signed amount. Transactions come back oldest-first
// from the parser (opposite of the PDF's newest-first print order), so
// index i+1 here is the next transaction forward in time.
let balanceMismatches = 0
for (let i = 0; i < transactions.length - 1; i++) {
  const cur = transactions[i]
  const next = transactions[i + 1]
  const expected = Number((cur.balance_after + next.amount).toFixed(2))
  if (Math.abs(expected - next.balance_after) > 0.01) {
    balanceMismatches++
    if (balanceMismatches <= 5) {
      console.error(`FAIL balance chain at ${i}->${i+1}: ${cur.balance_after} + ${next.amount} = ${expected}, expected ${next.balance_after}`)
    }
  }
}
check('balance chain mismatches', balanceMismatches, 0)

// Known specific rows from the sample (see design spec) — first and last
// by date, since the parser returns oldest-first.
check('first txn date', transactions[0].date, '2025-12-18')
check('first txn category', transactions[0].category, 'bank_fee')
check('first txn amount (debit, negative)', transactions[0].amount, -8.75)
check('last txn date', transactions[transactions.length - 1].date, '2026-08-10')

const categoryCounts = {}
for (const t of transactions) categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1
console.log('category counts:', JSON.stringify(categoryCounts, null, 2))

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS — all bank-parse checks')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/verify/bank-parse.check.mjs`
Expected: fails with a module-not-found error.

- [ ] **Step 3: Implement the parser**

Create `src/lib/parsers/bank/parseHapoalimStatement.js`:

```js
import { pdfText, lines, fields, num } from '../wolt/text-utils.js'

// Bank Hapoalim prints dates as DD/MM/YYYY (Wolt's ddmmyyyy helper expects
// dots, not slashes, so this is a small local variant rather than a shared one).
function ddmmyyyySlash(s) {
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

const CATEGORY_RULES = [
  [/ישראכרט|כרטיסי אשראי/, 'card_settlement_isracard'],
  [/מקס/, 'card_settlement_max'],
  [/אמריקן אקספרס/, 'card_settlement_amex'],
  [/דיינרס/, 'card_settlement_diners'],
  [/^שיק$/, 'check'],
  [/העברה|העב['׳]/, 'transfer'],
  [/ביטוח לאומי/, 'national_insurance'],
  [/מע"מ|מכס/, 'vat'],
  [/חברת החשמל/, 'utilities'],
  [/מסלול|מפעולות-ישיר|דמי נהול|פנקסי שיקים|הפק מזומן/, 'bank_fee'],
  [/רבית/, 'interest'],
  [/הפקדה לפקדון/, 'deposit'],
  [/זיכוי/, 'credit_other'],
  [/החזר חיוב/, 'reversal'],
]

export function inferBankCategory(description) {
  if (!description) return 'other'
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description)) return cat
  return 'other'
}

// A real transaction row's 4th tab-separated field always starts with ₪
// (the balance). This excludes the one false positive found in the real
// sample: the "10/08/2026 - 10/08/2025" period-range header line, which
// also starts with a date but has no ₪-prefixed 4th field.
const ROW_RE = /^\d{2}\/\d{2}\/\d{4}\t/

export async function parseHapoalimStatement(buffer) {
  const text = await pdfText(buffer)
  const ls = lines(text)

  // Pass 1: pull out raw rows in the PDF's print order (newest first).
  const raw = []
  for (const l of ls) {
    if (!ROW_RE.test(l)) continue
    const f = fields(l)
    if (!f[3] || !f[3].startsWith('₪')) continue
    const date = ddmmyyyySlash(f[0])
    const amount = num(f[2])
    const balance_after = num(f[3])
    if (date == null || amount == null || balance_after == null) continue
    raw.push({ date, description: f[1], amount, balance_after })
  }

  // Pass 2: resolve debit/credit direction. Rows are newest-first and
  // contiguous, so raw[i+1] is the chronologically-earlier row — compare
  // its balance against raw[i]'s to see which of the two column
  // hypotheses (debit vs credit) reproduces raw[i]'s printed balance.
  // Verified against all 397 real transactions in the sample file (see
  // docs/superpowers/specs/2026-08-14-bank-statement-ingestion-design.md).
  const resolved = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const prevBalance = i + 1 < raw.length ? raw[i + 1].balance_after : null

    let signedAmount
    if (prevBalance == null) {
      // Oldest row in this file — nothing earlier to compare against.
      // The debit hypothesis (signedAmount = -amount) matches the
      // majority pattern and is correct for the one case observed
      // (a positive-amount checkbook fee assumed against a zero prior
      // balance).
      signedAmount = -cur.amount
    } else {
      const asDebit = prevBalance - cur.amount
      const asCredit = prevBalance + cur.amount
      const okDebit = Math.abs(asDebit - cur.balance_after) < 0.01
      const okCredit = Math.abs(asCredit - cur.balance_after) < 0.01
      signedAmount = okDebit ? -cur.amount : cur.amount
      if (!okDebit && !okCredit) signedAmount = cur.amount // unresolvable; keep as printed
    }

    resolved.push({
      date: cur.date,
      description: cur.description,
      amount: signedAmount,
      balance_after: cur.balance_after,
      category: inferBankCategory(cur.description),
    })
  }

  // Return oldest-first — more natural for storage and for the balance-chain
  // sanity check in the verify script.
  resolved.reverse()
  return { transactions: resolved }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/verify/bank-parse.check.mjs`
Expected: `PASS — all bank-parse checks`, plus a printed category-count breakdown to eyeball against the design spec's table.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/bank/parseHapoalimStatement.js scripts/verify/bank-parse.check.mjs
git commit -m "Add Bank Hapoalim statement parser with balance-delta debit/credit inference"
```

---

### Task 3: DB layer

**Files:**
- Create: `src/lib/db/bank.js`
- Create: `scripts/verify/bank-db.check.mjs`

**Interfaces:**
- Consumes: transactions in the shape produced by Task 2.
- Produces:
  - `insertBankTransactions(rows) -> Promise<{ inserted: number, skipped: number }>`
  - `getBankMonthlySummary(monthStartISO, monthEndExclusiveISO) -> Promise<{ totalIn: number, totalOut: number, net: number, endingBalance: number|null, byCategory: Array<{category, in, out}>, transactions: Array<row> }>`

- [ ] **Step 1: Write the check script (fails — module doesn't exist yet)**

Requires Task 1's SQL to have been run already. Create `scripts/verify/bank-db.check.mjs`:

```js
import { insertBankTransactions, getBankMonthlySummary } from '../../src/lib/db/bank.js'

let failed = 0
function check(label, actual, expected) {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

const testRows = [
  { date: '2099-01-05', description: 'בדיקת מבחן א', amount: -100, balance_after: 900, category: 'other' },
  { date: '2099-01-10', description: 'בדיקת מבחן ב', amount: 250, balance_after: 1150, category: 'credit_other' },
]

const first = await insertBankTransactions(testRows)
check('first insert count', first.inserted, 2)
check('first insert skipped', first.skipped, 0)

// Re-inserting the same rows must be a safe no-op (dedup by source_row_hash).
const second = await insertBankTransactions(testRows)
check('second insert count', second.inserted, 0)
check('second insert skipped', second.skipped, 2)

const summary = await getBankMonthlySummary('2099-01-01T00:00:00.000Z', '2099-02-01T00:00:00.000Z')
check('summary totalIn', summary.totalIn, 250)
check('summary totalOut', summary.totalOut, 100)
check('summary net', summary.net, 150)
check('summary endingBalance', summary.endingBalance, 1150)

// Cleanup — remove the test rows so they don't linger in the real DB.
const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
await supabase.from('bank_transactions').delete().eq('description', 'בדיקת מבחן א')
await supabase.from('bank_transactions').delete().eq('description', 'בדיקת מבחן ב')

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('PASS — all bank-db checks')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/bank-db.check.mjs`
Expected: fails — module not found (or `42P01` if Task 1's SQL hasn't been run yet; if so, stop and confirm the SQL was run before continuing).

- [ ] **Step 3: Implement the DB layer**

Create `src/lib/db/bank.js`:

```js
import 'server-only'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'

export function bankTransactionHash({ date, description, amount, balance_after }) {
  const key = `${date}|${description}|${amount}|${balance_after}`
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

// Idempotent — duplicates (matching source_row_hash) are skipped silently.
// Same pattern as insertExpenses in src/lib/db/expenses.js.
export async function insertBankTransactions(rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 }
  const payload = rows.map((r) => ({
    txn_date: r.date,
    description: r.description,
    amount: r.amount,
    balance_after: r.balance_after,
    category: r.category,
    source_row_hash: bankTransactionHash(r),
  }))
  const { data, error } = await supabase
    .from('bank_transactions')
    .upsert(payload, { onConflict: 'source_row_hash', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return { inserted: data?.length || 0, skipped: rows.length - (data?.length || 0) }
}

export async function getBankMonthlySummary(monthStartISO, monthEndExclusiveISO) {
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('txn_date, description, amount, balance_after, category')
    .gte('txn_date', monthStartISO)
    .lt('txn_date', monthEndExclusiveISO)
    .order('txn_date', { ascending: true })
  if (error) throw error

  let totalIn = 0
  let totalOut = 0
  const byCategory = new Map()
  for (const r of data) {
    const amt = Number(r.amount)
    if (amt >= 0) totalIn += amt
    else totalOut += -amt
    const e = byCategory.get(r.category) || { category: r.category, in: 0, out: 0 }
    if (amt >= 0) e.in += amt
    else e.out += -amt
    byCategory.set(r.category, e)
  }
  const endingBalance = data.length ? Number(data[data.length - 1].balance_after) : null

  return {
    totalIn: Number(totalIn.toFixed(2)),
    totalOut: Number(totalOut.toFixed(2)),
    net: Number((totalIn - totalOut).toFixed(2)),
    endingBalance,
    byCategory: [...byCategory.values()],
    transactions: data,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --env-file=.env.local --import ./scripts/verify/alias-loader.mjs scripts/verify/bank-db.check.mjs`
Expected: `PASS — all bank-db checks`

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/bank.js scripts/verify/bank-db.check.mjs
git commit -m "Add bank_transactions DB layer (dedup insert + monthly summary read)"
```

---

### Task 4: Upload API route

**Files:**
- Create: `src/app/api/admin/bank/upload/route.js`

**Interfaces:**
- Consumes: `isAdmin` from `@/lib/admin`, `parseHapoalimStatement` from Task 2, `insertBankTransactions` from Task 3.
- Produces: `POST /api/admin/bank/upload` accepting `multipart/form-data` with a single `file` field, returning `{ ok: true, parsed, inserted, skipped }` or `{ error }`.

- [ ] **Step 1: Create the route**

Create `src/app/api/admin/bank/upload/route.js`:

```js
import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { parseHapoalimStatement } from '@/lib/parsers/bank/parseHapoalimStatement'
import { insertBankTransactions } from '@/lib/db/bank'

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const file = form.get('file')
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())

  let parsed
  try {
    parsed = await parseHapoalimStatement(buffer)
  } catch (e) {
    return NextResponse.json({ error: 'Parse error: ' + e.message }, { status: 400 })
  }
  if (!parsed.transactions.length) {
    return NextResponse.json({ error: 'Parsed to 0 transactions — wrong file?' }, { status: 400 })
  }

  let result
  try {
    result = await insertBankTransactions(parsed.transactions)
  } catch (e) {
    return NextResponse.json({ error: 'Database write failed: ' + e.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    parsed: parsed.transactions.length,
    inserted: result.inserted,
    skipped: result.skipped,
  })
}
```

- [ ] **Step 2: Verify with the dev server against the real file**

Start the dev server if needed: `npm run dev` (background).

```bash
ADMIN_COOKIE=$(node --env-file=.env.local -e "console.log(require('crypto').createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex'))")
curl -s -b "ss_admin=$ADMIN_COOKIE" \
  -F "file=@$HOME/Downloads/current_account_operations_10.08.2026_14.48.03.pdf;type=application/pdf" \
  http://localhost:3000/api/admin/bank/upload | python3 -m json.tool
```

Expected: `{"ok": true, "parsed": 397, "inserted": 397, "skipped": 0}` on first run.

- [ ] **Step 3: Verify idempotency**

Run the exact same `curl` command again.
Expected: `{"ok": true, "parsed": 397, "inserted": 0, "skipped": 397}`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/bank/upload/route.js
git commit -m "Add bank statement upload API route"
```

---

### Task 5: Admin page + nav

**Files:**
- Create: `src/app/admin/(dashboard)/bank/UploadCard.js`
- Create: `src/app/admin/(dashboard)/bank/page.js`
- Create: `src/app/admin/(dashboard)/bank/bank.css`
- Modify: `src/components/AdminMonthPickerSlot.js`
- Modify: `src/app/admin/(dashboard)/layout.js`

**Interfaces:**
- Consumes: `POST /api/admin/bank/upload` (Task 4), `getBankMonthlySummary` (Task 3).

- [ ] **Step 1: Create the upload card**

Create `src/app/admin/(dashboard)/bank/UploadCard.js`:

```jsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UploadCard() {
  const router = useRouter()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setResult(null)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/admin/bank/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Upload failed')
      } else {
        setResult(json)
        router.refresh()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="card">
      <h2 className="section-h2">Upload bank statement</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Upload a "current account operations" PDF export from Bank Hapoalim online banking —
        any date range, any time. Re-uploading a file with overlapping dates is safe.
      </p>
      <form onSubmit={onSubmit} className="stack" style={{ gap: 12 }}>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          disabled={busy}
        />
        {file && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {file.name} ({Math.round(file.size / 1024)} KB)
          </span>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={!file || busy}>
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

      {result && (
        <div className="insight ok" style={{ marginTop: 12 }}>
          <div className="insight-title">✓ Statement processed</div>
          <div className="insight-body">
            {result.parsed} transactions parsed, {result.inserted} new, {result.skipped} already recorded.
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS file**

Create `src/app/admin/(dashboard)/bank/bank.css` (same minimal rules already duplicated per-page in `wolt.css`/`nayax.css` — following that existing convention rather than introducing a shared global file):

```css
.section-h2 {
  font-size: 1.05rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}
.kpi { padding: 16px; }
.kpi-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-muted);
  font-weight: 600;
}
.kpi-value {
  font-size: 1.6rem;
  font-weight: 700;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Create the page**

Create `src/app/admin/(dashboard)/bank/page.js`:

```jsx
import { getBankMonthlySummary } from '@/lib/db/bank'
import UploadCard from './UploadCard'
import './bank.css'

const ILS = new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })

const CATEGORY_LABELS = {
  card_settlement_isracard: 'Isracard settlement',
  card_settlement_max: 'MAX settlement',
  card_settlement_amex: 'Amex settlement',
  card_settlement_diners: 'Diners settlement',
  check: 'Checks',
  transfer: 'Transfers',
  national_insurance: 'National Insurance',
  vat: 'VAT',
  utilities: 'Utilities',
  bank_fee: 'Bank fees',
  interest: 'Interest',
  deposit: 'Deposit to savings',
  credit_other: 'Other credit',
  reversal: 'Reversal',
  other: 'Other',
}

function monthBoundsISO(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { startISO: start.toISOString(), endExclusiveISO: end.toISOString() }
}

export default async function BankPage({ searchParams }) {
  const sp = await searchParams
  const monthParam = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null

  // Default to the current calendar month, not "latest month with data" —
  // matches the fix already applied to the Wolt page, for the same reason:
  // the shared MonthPicker drops ?month= entirely for "this month".
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const selectedMonth = monthParam || currentMonth
  const monthLabel = new Date(`${selectedMonth}-01`).toLocaleString('en-IL', { month: 'long', year: 'numeric' })
  const { startISO, endExclusiveISO } = monthBoundsISO(selectedMonth)

  const summary = await getBankMonthlySummary(startISO, endExclusiveISO)
  const outCategories = summary.byCategory.filter((c) => c.out > 0).sort((a, b) => b.out - a.out)
  const inCategories = summary.byCategory.filter((c) => c.in > 0).sort((a, b) => b.in - a.in)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Bank — {monthLabel}</h1>
      </div>

      <UploadCard />

      {summary.transactions.length === 0 ? (
        <div className="card">
          <h2 className="section-h2">No bank data for {monthLabel}</h2>
          <p className="muted">Upload a statement above, or select a different month.</p>
        </div>
      ) : (
        <>
          <div className="kpi-row">
            <div className="card kpi">
              <div className="kpi-label">Money in</div>
              <div className="kpi-value">{ILS.format(summary.totalIn)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Money out</div>
              <div className="kpi-value">{ILS.format(summary.totalOut)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Net</div>
              <div className="kpi-value">{ILS.format(summary.net)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Ending balance</div>
              <div className="kpi-value">{summary.endingBalance != null ? ILS.format(summary.endingBalance) : '—'}</div>
            </div>
          </div>

          <div className="card">
            <h2 className="section-h2">Money out by category</h2>
            <table className="table">
              <thead>
                <tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {outCategories.map((c) => (
                  <tr key={c.category}>
                    <td>{CATEGORY_LABELS[c.category] || c.category}</td>
                    <td className="num">{ILS.format(c.out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="section-h2">Money in by category</h2>
            <table className="table">
              <thead>
                <tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {inCategories.map((c) => (
                  <tr key={c.category}>
                    <td>{CATEGORY_LABELS[c.category] || c.category}</td>
                    <td className="num">{ILS.format(c.in)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="section-h2">Transactions</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Category</th>
                  <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {summary.transactions.slice().reverse().map((t, i) => (
                  <tr key={i}>
                    <td>{new Date(t.txn_date).toLocaleDateString('en-IL')}</td>
                    <td>{t.description}</td>
                    <td className="muted" style={{ fontSize: '0.8rem' }}>{CATEGORY_LABELS[t.category] || t.category}</td>
                    <td className="num" style={{ color: t.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {ILS.format(t.amount)}
                    </td>
                    <td className="num">{ILS.format(t.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire up the month picker and nav**

In `src/components/AdminMonthPickerSlot.js`, change:

```js
const PATHS_WITH_MONTH = [
  '/admin',
  '/admin/wolt',
  '/admin/nayax',
  '/admin/finance',
  '/admin/expenses',
  '/admin/shifts',
]
```

to:

```js
const PATHS_WITH_MONTH = [
  '/admin',
  '/admin/wolt',
  '/admin/nayax',
  '/admin/finance',
  '/admin/expenses',
  '/admin/shifts',
  '/admin/bank',
]
```

In `src/app/admin/(dashboard)/layout.js`, change:

```jsx
        <NavLink href="/admin/expenses">Expenses</NavLink>
        <NavLink href="/admin/finance">Finance</NavLink>
```

to:

```jsx
        <NavLink href="/admin/expenses">Expenses</NavLink>
        <NavLink href="/admin/bank">Bank</NavLink>
        <NavLink href="/admin/finance">Finance</NavLink>
```

- [ ] **Step 5: Verify in the browser**

With the dev server running and Task 4's real-file upload already done, visit `http://localhost:3000/admin/bank?month=2026-08` (August 2026, since the sample file's transactions run through 2026-08-10). Confirm:
- KPI row shows non-zero money in/out.
- "Money out by category" is dominated by `card_settlement_isracard` (per the design spec's real counts) — sanity-check this matches expectations, since it's the category the owner most cares about getting right.
- The "Bank" nav link appears and the month picker works (switching months changes the data; "this month" behaves like the Wolt page's equivalent).

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/(dashboard)/bank" src/components/AdminMonthPickerSlot.js "src/app/admin/(dashboard)/layout.js"
git commit -m "Add /admin/bank page with upload card and category breakdown"
```

---

### Task 6: Full real-file pass and cleanup

- [ ] **Step 1:** With all prior tasks done, confirm the real sample file (397 transactions, Dec 2025 – Aug 2026) has been uploaded exactly once via the UI (not just curl) and appears correctly across all months it spans — spot-check at least 3 different months via the month picker.
- [ ] **Step 2:** Re-upload the same file through the UI a second time. Confirm the "Statement processed" banner shows `397 already recorded, 0 new` and no totals in the page change.
- [ ] **Step 3:** Cross-check one category total by hand against the raw file for one month — e.g. sum the `שיק` (check) rows for a specific month from the PDF directly and confirm it matches the "Checks" line in "Money out by category" for that month.
