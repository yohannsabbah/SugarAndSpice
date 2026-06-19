-- Sugar & Spice — finance / dashboard schema (v1: Wolt slice)
-- Run this once in the Supabase SQL editor:
--   Supabase dashboard → SQL Editor → New query → paste this → Run
--
-- BEFORE RUNNING: also create a Storage bucket named `documents` (Private)
--   Supabase dashboard → Storage → New bucket → name=documents, Public=off
--
-- Conventions match the existing employees/shifts schema:
--   - uuid primary keys, gen_random_uuid()
--   - timestamptz not null default now() for audit columns
--   - Row Level Security enabled, "anon all" policies (UI guards access)
--
-- Safe to re-run: every statement is idempotent.


------------------------------------------------------------------------
-- 1. documents — every uploaded file, regardless of source
------------------------------------------------------------------------
create table if not exists documents (
  id              uuid primary key default gen_random_uuid(),
  uploaded_at     timestamptz not null default now(),
  file_path       text not null,                    -- path in Storage bucket
  file_name       text not null,
  source          text not null,                    -- 'wolt' | 'nayax' | 'bank' | 'card' | 'manual'
  doc_type        text not null,                    -- see notes below
  period_start    date,                             -- nullable: some docs are one-off
  period_end      date,
  parse_status    text not null default 'pending',  -- 'pending' | 'parsed' | 'error'
  parse_error     text,
  parsed_at       timestamptz,
  raw_meta        jsonb
);
-- doc_type values used in v1:
--   wolt_invoice_w2m   — Wolt → Merchant invoice PDF
--   wolt_invoice_m2w   — Merchant → Wolt invoice PDF
--   wolt_netting       — Netting report PDF
--   wolt_sales_pdf     — Sales detail PDF (order list)
--   wolt_csv_purchases — purchases CSV from Merchant portal
--   wolt_csv_items     — items CSV from Merchant portal

create index if not exists documents_source_period_idx
  on documents (source, period_start desc);
create index if not exists documents_status_idx
  on documents (parse_status) where parse_status <> 'parsed';


------------------------------------------------------------------------
-- 2. wolt_periods — one row per Wolt half-month period
------------------------------------------------------------------------
create table if not exists wolt_periods (
  id                      uuid primary key default gen_random_uuid(),
  period_num              int not null,             -- 1..24 within the year
  period_year             int not null,
  period_start            date not null,
  period_end              date not null,
  invoice_date            date,

  wolt_invoice_no         text,                     -- e.g. '4958141'
  merchant_invoice_no     text,                     -- e.g. '660009'
  netting_no              text,                     -- e.g. '700009'

  -- Sales side (from MERCHANT_TO_WOLT_INVOICE)
  gross_sales_excl_vat    numeric(12,2),
  gross_sales_vat         numeric(12,2),
  gross_sales_incl_vat    numeric(12,2),
  refunds_incl_vat        numeric(12,2) not null default 0,
  net_sales_incl_vat      numeric(12,2),            -- gross - refunds

  -- Fees side (from WOLT_TO_MERCHANT_INVOICE)
  wolt_fees_excl_vat      numeric(12,2),
  wolt_fees_vat           numeric(12,2),
  wolt_fees_incl_vat      numeric(12,2),

  -- Netting (from NETTING_REPORT)
  withholding_amount      numeric(12,2),
  withholding_pct         numeric(5,2) default 5,
  installments_amount     numeric(12,2) not null default 0,
  net_payout              numeric(12,2),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (period_year, period_num),
  unique (period_start, period_end)
);

create index if not exists wolt_periods_dates_idx
  on wolt_periods (period_start, period_end);


------------------------------------------------------------------------
-- 3. wolt_period_fees — each fee line from the Wolt → Merchant invoice
------------------------------------------------------------------------
create table if not exists wolt_period_fees (
  id                  uuid primary key default gen_random_uuid(),
  period_id           uuid not null references wolt_periods(id) on delete cascade,

  fee_category        text not null,
  -- One of:
  --   commission_pickup, commission_delivery, commission_delivery_woltplus,
  --   commission_addons, per_order_woltplus,
  --   ad_campaign, vat_adjustment, missing_item, other

  description         text,                         -- raw line description
  units               int,                          -- e.g. 35 orders for per-order fee
  base_amount         numeric(12,2),                -- "מכירות" base for commission rows

  amount_excl_vat     numeric(12,2),
  vat_amount          numeric(12,2),
  amount_incl_vat     numeric(12,2),

  -- Ad-specific
  campaign_id         text,
  campaign_start      date,
  campaign_end        date
);

create index if not exists wolt_period_fees_period_idx
  on wolt_period_fees (period_id);
create index if not exists wolt_period_fees_category_idx
  on wolt_period_fees (fee_category);


------------------------------------------------------------------------
-- 4. wolt_deductions — installments / netting deductions (iPad lease, etc.)
------------------------------------------------------------------------
create table if not exists wolt_deductions (
  id                       uuid primary key default gen_random_uuid(),
  period_id                uuid not null references wolt_periods(id) on delete cascade,

  item_description         text,
  receipt_no               text,
  original_invoice_no      text,
  total_price_incl_vat     numeric(12,2),
  installment_num          int,                     -- "חלק" — which payment
  installment_amount       numeric(12,2),
  remaining_after_payment  numeric(12,2)
);

create index if not exists wolt_deductions_period_idx
  on wolt_deductions (period_id);


------------------------------------------------------------------------
-- 5. wolt_orders — one row per order (merged from PDF SALES_REPORT + CSV)
------------------------------------------------------------------------
create table if not exists wolt_orders (
  id                  uuid primary key default gen_random_uuid(),
  period_id           uuid not null references wolt_periods(id) on delete cascade,

  -- Identifiers (different in CSV vs PDF — both kept for joins/debugging)
  order_no_public     text,                         -- '#789' from CSV
  order_line_no       text,                         -- '10000805' from PDF

  -- Timing
  placed_at           timestamptz not null,
  delivered_at        timestamptz,

  -- Status / type
  status              text not null,                -- 'delivered' | 'rejected'
  channel             text not null,                -- 'delivery' | 'pickup'
  is_woltplus         boolean not null default false,

  -- Money
  price_incl_vat      numeric(10,2) not null,
  price_excl_vat      numeric(10,2),

  -- Reviews (from CSV)
  review_score        smallint,
  review_comment      text,
  review_attributions text[]
);

create index if not exists wolt_orders_period_idx
  on wolt_orders (period_id, placed_at);
create index if not exists wolt_orders_placed_idx
  on wolt_orders (placed_at);
create index if not exists wolt_orders_status_idx
  on wolt_orders (status) where status <> 'delivered';


------------------------------------------------------------------------
-- 6. items — normalized catalog (categorization layer)
------------------------------------------------------------------------
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  merchant_sku    text,                             -- nullable; matches CSV when present
  display_name    text not null,                    -- normalized name (Hebrew or English)
  category        text,
  -- Categories the parser will auto-assign from name patterns:
  --   cake, coffee_hot, coffee_cold, matcha, tea, mochi, pastry,
  --   soda, kids, food, other
  created_at      timestamptz not null default now()
);

create unique index if not exists items_sku_unique
  on items (merchant_sku) where merchant_sku is not null;
create index if not exists items_display_name_idx
  on items (display_name);


------------------------------------------------------------------------
-- 7. wolt_order_items — items parsed from the CSV "Items" free-text field
------------------------------------------------------------------------
create table if not exists wolt_order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references wolt_orders(id) on delete cascade,
  item_id               uuid references items(id),

  item_name             text not null,              -- raw name as parsed
  merchant_sku          text,
  quantity              int not null,
  unit_price_incl_vat   numeric(10,2),
  line_total_incl_vat   numeric(10,2)
);

create index if not exists wolt_order_items_order_idx
  on wolt_order_items (order_id);
create index if not exists wolt_order_items_item_idx
  on wolt_order_items (item_id);


------------------------------------------------------------------------
-- 8. wolt_period_items — monthly item aggregates (from the items CSV)
------------------------------------------------------------------------
create table if not exists wolt_period_items (
  id                  uuid primary key default gen_random_uuid(),
  period_id           uuid references wolt_periods(id) on delete cascade,
  -- Note: the items CSV is whole-month, not per-period. We allow period_id null
  -- and use month_start to attach to a calendar month instead.
  month_start         date,                         -- first day of the month this aggregate covers
  item_id             uuid references items(id),

  item_name           text not null,
  merchant_sku        text,
  units_sold          int not null,
  revenue_incl_vat    numeric(12,2) not null
);

create index if not exists wolt_period_items_month_idx
  on wolt_period_items (month_start);
create index if not exists wolt_period_items_item_idx
  on wolt_period_items (item_id);


------------------------------------------------------------------------
-- Row Level Security
-- Same pattern as employees/shifts: enabled with permissive "anon all"
-- policies. App-level access control is handled by the admin PIN/login.
------------------------------------------------------------------------
alter table documents          enable row level security;
alter table wolt_periods       enable row level security;
alter table wolt_period_fees   enable row level security;
alter table wolt_deductions    enable row level security;
alter table wolt_orders        enable row level security;
alter table wolt_order_items   enable row level security;
alter table wolt_period_items  enable row level security;
alter table items              enable row level security;

drop policy if exists "documents anon all" on documents;
create policy "documents anon all" on documents
  for all using (true) with check (true);

drop policy if exists "wolt_periods anon all" on wolt_periods;
create policy "wolt_periods anon all" on wolt_periods
  for all using (true) with check (true);

drop policy if exists "wolt_period_fees anon all" on wolt_period_fees;
create policy "wolt_period_fees anon all" on wolt_period_fees
  for all using (true) with check (true);

drop policy if exists "wolt_deductions anon all" on wolt_deductions;
create policy "wolt_deductions anon all" on wolt_deductions
  for all using (true) with check (true);

drop policy if exists "wolt_orders anon all" on wolt_orders;
create policy "wolt_orders anon all" on wolt_orders
  for all using (true) with check (true);

drop policy if exists "wolt_order_items anon all" on wolt_order_items;
create policy "wolt_order_items anon all" on wolt_order_items
  for all using (true) with check (true);

drop policy if exists "wolt_period_items anon all" on wolt_period_items;
create policy "wolt_period_items anon all" on wolt_period_items
  for all using (true) with check (true);

drop policy if exists "items anon all" on items;
create policy "items anon all" on items
  for all using (true) with check (true);


------------------------------------------------------------------------
-- 9. nayax_days — daily in-store revenue total
-- One row per calendar day. Source 'manual' for the legacy sales-data.json
-- backfill; 'nayax_csv' once daily exports start arriving.
------------------------------------------------------------------------
create table if not exists nayax_days (
  date            date primary key,
  revenue         numeric(12,2) not null,
  source          text not null default 'manual',  -- 'manual' | 'nayax_csv'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- No extra index needed: the `date` primary key is a B-tree, which already
-- handles month-range queries (where date >= '2026-05-01' and date < '2026-06-01').


------------------------------------------------------------------------
-- 10. nayax_periods — one row per calendar month (Nayax monthly CSV bundle)
------------------------------------------------------------------------
create table if not exists nayax_periods (
  id                    uuid primary key default gen_random_uuid(),
  period_month          date not null,                  -- always first of month, e.g. 2026-05-01
  period_label          text,                           -- 'May 2026' (cached for display)

  -- Totals across all payment methods (from payments CSV grand total)
  gross_incl_vat        numeric(12,2),                  -- before refunds
  refunds_incl_vat      numeric(12,2) not null default 0,
  net_incl_vat          numeric(12,2),                  -- gross - refunds
  total_orders          int,
  refund_count          int not null default 0,

  -- Derived (cached for fast list queries)
  avg_ticket            numeric(10,2),
  units_sold            int,                            -- from items CSV grand total

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (period_month)
);

create index if not exists nayax_periods_month_idx
  on nayax_periods (period_month desc);


------------------------------------------------------------------------
-- 11. nayax_period_hours — 24 rows per month (hourly CSV)
------------------------------------------------------------------------
create table if not exists nayax_period_hours (
  id              uuid primary key default gen_random_uuid(),
  period_id       uuid not null references nayax_periods(id) on delete cascade,
  hour            smallint not null,                    -- 0..23
  revenue         numeric(12,2) not null default 0,
  orders          int not null default 0,
  avg_ticket      numeric(10,2),
  unique (period_id, hour)
);

create index if not exists nayax_period_hours_period_idx
  on nayax_period_hours (period_id);


------------------------------------------------------------------------
-- 12. nayax_period_payments — payment-method split (payments CSV)
-- Methods: 'cash', 'visa', 'mastercard', 'amex', 'diners', 'other'
------------------------------------------------------------------------
create table if not exists nayax_period_payments (
  id              uuid primary key default gen_random_uuid(),
  period_id       uuid not null references nayax_periods(id) on delete cascade,
  method          text not null,
  orders          int not null default 0,
  gross_incl_vat  numeric(12,2) not null default 0,
  refund_count    int not null default 0,
  refunds_incl_vat numeric(12,2) not null default 0,
  net_incl_vat    numeric(12,2) not null default 0,
  unique (period_id, method)
);

create index if not exists nayax_period_payments_period_idx
  on nayax_period_payments (period_id);


------------------------------------------------------------------------
-- 13. nayax_period_items — item × month aggregates (items CSV)
-- Mirrors wolt_period_items, but for in-store sales. Reuses items catalog.
------------------------------------------------------------------------
create table if not exists nayax_period_items (
  id                  uuid primary key default gen_random_uuid(),
  period_id           uuid not null references nayax_periods(id) on delete cascade,
  item_id             uuid references items(id),

  item_name           text not null,                    -- raw name as parsed (with emoji)
  merchant_sku        text,                             -- SKU column from CSV
  raw_category        text,                             -- Hierarchy column from CSV (e.g. '12 Hot Basics')
  units_sold          int not null,
  revenue_incl_vat    numeric(12,2) not null,
  avg_price_incl_vat  numeric(10,2),
  share_of_total      numeric(8,6)
);

create index if not exists nayax_period_items_period_idx
  on nayax_period_items (period_id);
create index if not exists nayax_period_items_item_idx
  on nayax_period_items (item_id);


------------------------------------------------------------------------
-- RLS for Nayax tables
------------------------------------------------------------------------
alter table nayax_days             enable row level security;
alter table nayax_periods          enable row level security;
alter table nayax_period_hours     enable row level security;
alter table nayax_period_payments  enable row level security;
alter table nayax_period_items     enable row level security;

drop policy if exists "nayax_days anon all" on nayax_days;
create policy "nayax_days anon all" on nayax_days
  for all using (true) with check (true);

drop policy if exists "nayax_periods anon all" on nayax_periods;
create policy "nayax_periods anon all" on nayax_periods
  for all using (true) with check (true);

drop policy if exists "nayax_period_hours anon all" on nayax_period_hours;
create policy "nayax_period_hours anon all" on nayax_period_hours
  for all using (true) with check (true);

drop policy if exists "nayax_period_payments anon all" on nayax_period_payments;
create policy "nayax_period_payments anon all" on nayax_period_payments
  for all using (true) with check (true);

drop policy if exists "nayax_period_items anon all" on nayax_period_items;
create policy "nayax_period_items anon all" on nayax_period_items
  for all using (true) with check (true);


------------------------------------------------------------------------
-- 14. payment_methods — registry of all ways money leaves the business.
-- Credit cards (one row per card last4), cash, bank transfer, standing
-- order, etc. is_business=false means charges on it are excluded from P&L.
------------------------------------------------------------------------
create table if not exists payment_methods (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,                   -- 'credit_card' | 'cash' | 'bank_transfer' | 'standing_order' | 'other'
  display_name    text not null,                   -- 'MAX Back 6410'
  card_last4      text,                            -- '6410' (CC only)
  issuer          text,                            -- 'max' | 'cal' | 'isracard' | 'amex' | null
  is_business     boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (card_last4, issuer)                      -- one row per real-world card
);

create index if not exists payment_methods_kind_idx on payment_methods (kind);


------------------------------------------------------------------------
-- 15. expense_documents — every uploaded statement file
------------------------------------------------------------------------
create table if not exists expense_documents (
  id                 uuid primary key default gen_random_uuid(),
  uploaded_at        timestamptz not null default now(),
  file_name          text not null,
  source             text not null,                -- 'max_xlsx' | 'cal_xlsx' | 'isracard_xlsx' | 'amex_xlsx' | 'manual'
  period_label       text,                         -- '06/2026' from MAX
  total_amount       numeric(12,2),                -- sum of charges (₪)
  row_count          int,
  cardholder         text,                         -- 'ג'ניפר אסתר סבח'
  parse_status       text not null default 'parsed',
  parse_error        text,
  raw_meta           jsonb
);

create index if not exists expense_documents_uploaded_idx
  on expense_documents (uploaded_at desc);


------------------------------------------------------------------------
-- 16. expenses — one row per charge / payment outgoing
------------------------------------------------------------------------
create table if not exists expenses (
  id                  uuid primary key default gen_random_uuid(),

  -- when
  transaction_date    date not null,               -- when the purchase happened
  billing_date        date,                        -- when it hit the bank (CC charge date)

  -- what
  vendor              text not null,               -- raw merchant name as imported
  vendor_normalized   text,                        -- lowercased / stripped, for matching rules
  description         text,

  -- money
  amount              numeric(12,2) not null,      -- always positive (it's an expense)
  currency            text not null default 'ILS',
  amount_original     numeric(12,2),
  currency_original   text,

  -- categorization
  category            text not null default 'other',
  -- Valid categories (kept in sync with src/lib/db/expenses.js):
  --   cogs_food, cogs_supplies, equipment, rent, salary, utilities,
  --   marketing, transport, fees, professional, taxes, insurance,
  --   personal, other
  source_category     text,                        -- raw category MAX/CAL/etc. provided

  is_business         boolean not null default true,

  -- how it was paid
  payment_method_id   uuid references payment_methods(id),
  transaction_type    text,                        -- 'regular' | 'deferred_30' | 'installments_N' | 'foreign'

  -- provenance
  source_doc_id       uuid references expense_documents(id) on delete set null,
  source_row_hash     text,                        -- hash for dedup across re-imports

  -- notes / tags
  notes               text,
  tags                text[],

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists expenses_transaction_date_idx
  on expenses (transaction_date desc);
create index if not exists expenses_category_idx
  on expenses (category);
create index if not exists expenses_payment_idx
  on expenses (payment_method_id);
-- dedup: re-uploading the same statement should be safe.
create unique index if not exists expenses_source_dedup
  on expenses (source_doc_id, source_row_hash)
  where source_doc_id is not null and source_row_hash is not null;


------------------------------------------------------------------------
-- RLS for expense tables
------------------------------------------------------------------------
alter table payment_methods    enable row level security;
alter table expense_documents  enable row level security;
alter table expenses           enable row level security;

drop policy if exists "payment_methods anon all" on payment_methods;
create policy "payment_methods anon all" on payment_methods
  for all using (true) with check (true);

drop policy if exists "expense_documents anon all" on expense_documents;
create policy "expense_documents anon all" on expense_documents
  for all using (true) with check (true);

drop policy if exists "expenses anon all" on expenses;
create policy "expenses anon all" on expenses
  for all using (true) with check (true);
