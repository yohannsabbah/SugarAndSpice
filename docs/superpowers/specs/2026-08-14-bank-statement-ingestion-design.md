# Bank statement ingestion — design

Date: 2026-08-14
Status: approved (pending spec review)

## Problem

No bank data exists anywhere in the app — `documents.source = 'bank'` was
anticipated in the schema comments but never implemented. The owner wants
visibility into what's leaving the business bank account (supplier/vendor
payments via checks and transfers, taxes, fees) more than a full
reconciliation system. The available export is a PDF ("current account
operations") from Bank Hapoalim's online banking, covering an arbitrary
date range (the sample covers Dec 2025 – Aug 2026, 397 transactions,
19 pages) in one file.

## Non-goals (this pass)

- No manual per-transaction supplier tagging (checks/transfers have no
  payee name in the export — confirmed by inspecting the real file. A
  category-level total is the ceiling of what this data alone can show).
  Explicitly deferred, confirmed with the owner.
- No reconciliation against Wolt payouts, card settlements, or expenses.
  Real opportunity later (e.g. matching `זיכוי` credits against known Wolt
  net-payout amounts), out of scope now.
- No support for other banks' export formats — Bank Hapoalim only, since
  that's the real sample in hand. Extending to another bank later is a
  separate parser, not a redesign.

## The parsing problem and its solution

Verified against the real file (`pdf-parse` output, not the PDF's visual
rendering): each transaction is a single tab-separated line —
`date, description, amount, balance-after, "##"` — followed by a lone
footnote-code line (`1` or `2`, meaning not established, captured but
unused).

**The amount column does not say debit or credit.** The source PDF has
two columns (חובה/debit, זכות/credit); text extraction collapses them into
one number per row since only one of the two is ever filled in, with no
marker for which column it came from.

**Resolution: infer direction from the running balance.** Rows print
newest-first. For each row, compare its `balance_after` against the
previous (chronologically earlier — i.e. the *next* row down in print
order) row's balance:
- If `previous_balance − amount == balance_after` → debit (outflow)
- If `previous_balance + amount == balance_after` → credit (inflow)

Verified programmatically against all 397 real transactions in the sample
file: **396/397 resolved with zero ambiguity** (exactly one formula
matched in each case, including a fee-reversal row where the printed
amount was itself already negative — the formula handles that correctly
with no special-casing). The 397th "mismatch" was a false positive from
matching the PDF's period header line ("10/08/2026 - 10/08/2025") as if it
were a transaction row; excluding lines whose 4th field doesn't start with
`₪` removes it.

The one real edge case: the **oldest transaction in a given file** has no
earlier row to compare against. Fallback: assume debit if the printed
amount is positive, credit if negative (matches the majority pattern
observed). This only affects one row per upload, and in practice most
uploads will re-cover dates already in the DB, so it rarely matters.

## Categorization

Same regex-rule pattern as `inferCategory` in `src/lib/db/wolt.js`, applied
to the raw description text (which carries minor RTL-artifact punctuation
like a trailing `)` on "בע"מ" that the regexes tolerate):

| Category | Matches |
|---|---|
| `card_settlement_isracard` | ישראכרט, כרטיסי אשראי |
| `card_settlement_max` | מקס |
| `card_settlement_amex` | אמריקן אקספרס |
| `card_settlement_diners` | דיינרס |
| `check` | שיק |
| `transfer` | העברה, העב' |
| `national_insurance` | ביטוח לאומי |
| `vat` | מע"מ, מכס |
| `utilities` | חברת החשמל |
| `bank_fee` | מסלול, מפעולות-ישיר, דמי נהול, פנקסי שיקים, הפק מזומן |
| `interest` | רבית |
| `deposit` | הפקדה לפקדון |
| `credit_other` | זיכוי |
| `reversal` | החזר חיוב |
| `other` | anything unmatched |

The card-settlement categories are aggregate settlement totals, not
itemized purchases — they overlap conceptually with the `expenses` table
(populated from MAX card statements) but are not merged with it in this
pass. `check` and `transfer` are the categories that actually answer "what
am I paying suppliers" from this data; everything else is a known,
labelable fixed cost.

## Data model

One new table, `bank_transactions`:

```sql
create table if not exists bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  txn_date          date not null,
  description       text not null,       -- raw, as printed
  amount            numeric(12,2) not null, -- signed: + credit/inflow, - debit/outflow
  balance_after     numeric(12,2),
  category          text not null,
  footnote_code     text,                 -- raw '1'/'2' from the source, unused for now
  source_row_hash   text not null unique, -- sha256(date|description|amount|balance_after), truncated — same pattern as expenses.source_row_hash
  created_at        timestamptz not null default now()
);
```

No parent "statement" or "document" record — unlike Wolt (which needed
periods to cross-reference multiple document types) or Expenses (which
scopes dedup per uploaded document), a bank transaction is fully
self-describing and dedups globally by content hash. Re-uploading a file
whose date range overlaps a previous upload is always safe — overlapping
rows hash identically and are silently skipped (`ON CONFLICT DO NOTHING`
via Supabase `upsert(..., { onConflict: 'source_row_hash', ignoreDuplicates: true })`,
exactly the pattern `insertExpenses` already uses).

## Code organization

New files, mirroring the existing `wolt`/`nayax`/`expenses` structure:
- `src/lib/parsers/bank/parseHapoalimStatement.js` — the parser described
  above. Reuses `pdfText`, `lines`, `fields`, `num` from
  `src/lib/parsers/wolt/text-utils.js` (already bank-agnostic generic PDF
  utilities); adds its own small slash-date parser locally rather than
  touching the Wolt module.
- `src/lib/db/bank.js` — `insertBankTransactions` (upsert/dedup, mirrors
  `insertExpenses`), plus read helpers for the page (monthly totals by
  category, in/out/net, running balance).
- `src/app/api/admin/bank/upload/route.js` — upload endpoint, single-file
  (no multi-type classification needed — there's only one file type here).
- `src/app/admin/(dashboard)/bank/page.js` + `UploadCard.js` — new admin
  page, added to `PATHS_WITH_MONTH` in `AdminMonthPickerSlot.js` so the
  shared month picker applies here too.

Modified: `supabase-finance-schema.sql` (new table, same "run in the
Supabase SQL editor" flow as before).

## UI

- KPI row: total in, total out, net change, ending balance — for the
  selected month.
- **Outflow by category** table — the primary view per the owner's stated
  priority, sorted by amount descending.
- Inflow by category table — secondary, smaller.
- Plain transaction list for the month (date, description, amount,
  category, running balance).

## Testing

- `scripts/verify/bank-parse.check.mjs` — runs the real parser against the
  actual sample file at `~/Downloads/current_account_operations_10.08.2026_14.48.03.pdf`
  (this path is machine-local, not committed; the check script takes the
  path as an argv override with a sensible default) and asserts: 397
  transactions parsed, debit/credit direction verified against balance
  deltas for every row, category counts match the table above.
- Manual: upload the real file through the UI, confirm KPIs/tables render,
  re-upload the same file, confirm no duplicate rows.
