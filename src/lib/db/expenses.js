import 'server-only'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Category enum (kept in sync with the supabase schema comment)
// ─────────────────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  'cogs_food',
  'cogs_supplies',
  'equipment',
  'rent',
  'salary',
  'utilities',
  'marketing',
  'transport',
  'fees',
  'professional',
  'taxes',
  'insurance',
  'meals',
  'personal',
  'other',
]

export const CATEGORY_LABEL = {
  cogs_food:     'COGS — food',
  cogs_supplies: 'COGS — supplies',
  equipment:     'Equipment',
  rent:          'Rent',
  salary:        'Salary',
  utilities:     'Utilities',
  marketing:     'Marketing',
  transport:     'Transport',
  fees:          'Fees',
  professional:  'Professional',
  taxes:         'Taxes',
  insurance:     'Insurance',
  meals:         'Meals',
  personal:      'Personal (excl.)',
  other:         'Other',
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-categorization
// Tried in order: vendor-name regexes (most specific) → MAX source_category
// (the Hebrew label MAX assigns) → fallback 'other'.
// Owner edits in the UI override these forever (rows store the chosen category).
// ─────────────────────────────────────────────────────────────────────────────
const VENDOR_RULES = [
  // Supermarkets & grocery — coffee shop raw materials
  [/אושר עד|am:?pm|רמי לוי|יוניברס|booom|מינימרקט|שופרסל|ויקטורי|טיב טעם|יוחננוף|tiv ?taam|super[- ]?pharm|am-?pm/i, 'cogs_food'],
  // Fruit/veg/butcher/bakery suppliers
  [/פירות|ירקות|אטליז|מאפיה|מאפייה|לחמ(?:יה|נייה)|פיצריה|גן המלך|מר קייק|חלב|hagalil|חלבי/i, 'cogs_food'],
  // Packaging / paper / cleaning supplies
  [/פעמית|אריזות|נייר|niyar|כוסות|disposable|cleaning|ניקוי|חד פעמ/i, 'cogs_supplies'],
  // Kitchen equipment / hardware
  [/ארקוסטיל|kitchen|kit(?:tch)?en|hardware|בית מטבח|כלי בית|מתכת|smart ?store|cookplus/i, 'equipment'],
  // Parking, fuel, public transport
  [/פנגו|pango|תחבורה|רכבת|אגד|דן|metropolin|מטרופולין|fuel|דלק|paz|פז|sonol|סונול|delek|חניון/i, 'transport'],
  // Insurance
  [/ביטוח|רוזן|איילון|aig|הראל|מנורה|כלל ביטוח|הפניקס|harel/i, 'insurance'],
  // Utilities — power, water, gas, internet, telecom
  [/חשמל|electric|מי כרמל|מי הגליל|מקורות|water|בזק|bezeq|פרטנר|partner|cellcom|סלקום|hot|hot ?mobile|netvision|נטוויז'ן/i, 'utilities'],
  // Municipality / govt
  [/עירייה|ארנונה|רשות המסים|מ\.ה?ביטוח לאומי|tax|מע"מ|מעמ/i, 'taxes'],
  // Professional services
  [/רואה חשבון|cpa|עו"ד|עו״ד|עורך דין|lawyer|accountant|יועץ/i, 'professional'],
  // Bank / CC processing fees
  [/עמלת|amlat|fee|בנק (?:הפועלים|לאומי|דיסקונט|מזרחי)|cal|max|isracard|אמקס/i, 'fees'],
  // Marketing / ads
  [/google ?ads?|facebook|meta|פייסבוק|אינסטגרם|tiktok|wolt ads?|פרסום|advertis|seo/i, 'marketing'],
  // Restaurants / meals — business meals & competitor scouting
  [/לגנדה|מסעדה|restaurant|cafe|בית קפה|בר/i, 'meals'],
]

const MAX_SOURCE_FALLBACK = {
  'מזון וצריכה':           'cogs_food',
  'מסעדות, קפה וברים':     'meals',
  'מסעדות וקפה':           'meals',
  'תחבורה ורכבים':         'transport',
  'ביטוח':                 'insurance',
  'עירייה וממשלה':         'taxes',
  'בילוי ופנאי':           'other',
  'חשמל ותקשורת':          'utilities',
  'בריאות וקוסמטיקה':      'other',
  'הלבשה':                 'other',
  'עיצוב הבית':            'cogs_supplies',  // home design store (paper/equipment for the shop)
  'שונות':                 'other',
}

export function inferExpenseCategory(vendorNormalized, sourceCategory) {
  if (vendorNormalized) {
    for (const [re, cat] of VENDOR_RULES) {
      if (re.test(vendorNormalized)) return cat
    }
  }
  if (sourceCategory && MAX_SOURCE_FALLBACK[sourceCategory.trim()]) {
    return MAX_SOURCE_FALLBACK[sourceCategory.trim()]
  }
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// payment_methods
// ─────────────────────────────────────────────────────────────────────────────
export async function listPaymentMethods() {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      const e = new Error('payment_methods table missing')
      e.missingSchema = true
      throw e
    }
    throw error
  }
  return data
}

// Get or create the payment_method row for a given credit card.
export async function upsertCreditCard({ card_last4, issuer, display_name }) {
  const { data: existing } = await supabase
    .from('payment_methods')
    .select('id')
    .eq('card_last4', card_last4)
    .eq('issuer', issuer)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('payment_methods')
    .insert({
      kind: 'credit_card',
      display_name: display_name || `${issuer.toUpperCase()} ${card_last4}`,
      card_last4,
      issuer,
      is_business: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ─────────────────────────────────────────────────────────────────────────────
// expense_documents
// ─────────────────────────────────────────────────────────────────────────────
export async function insertExpenseDocument(doc) {
  const { data, error } = await supabase
    .from('expense_documents')
    .insert({
      file_name: doc.file_name,
      source: doc.source,
      period_label: doc.period_label || null,
      total_amount: doc.total_amount ?? null,
      row_count: doc.row_count ?? null,
      cardholder: doc.cardholder || null,
      parse_status: 'parsed',
      raw_meta: doc.raw_meta || null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ─────────────────────────────────────────────────────────────────────────────
// expenses
// ─────────────────────────────────────────────────────────────────────────────
// Compute a stable hash from the source-row fields. Re-importing the same
// statement produces the same hash → unique index prevents duplicates.
export function rowHash({ transaction_date, vendor, amount, card_last4 }) {
  const key = `${transaction_date}|${vendor}|${amount}|${card_last4 || ''}`
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

// Insert a batch of parsed-and-categorized expense rows. Idempotent — duplicates
// (matching source_doc_id + source_row_hash) are skipped silently.
export async function insertExpenses(rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 }
  const { data, error } = await supabase
    .from('expenses')
    .upsert(rows, {
      onConflict: 'source_doc_id,source_row_hash',
      ignoreDuplicates: true,
    })
    .select('id')
  if (error) throw error
  return { inserted: data?.length || 0, skipped: rows.length - (data?.length || 0) }
}

// Read helpers — used by the /admin/expenses page
export async function listExpenses({ month } = {}) {
  let q = supabase
    .from('expenses')
    .select('*, payment_methods(display_name, card_last4, kind), expense_documents(period_label, file_name)')
    .order('transaction_date', { ascending: false })
    .order('id', { ascending: false })
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const endDate = new Date(y, m, 1)
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`
    q = q.gte('transaction_date', start).lt('transaction_date', end)
  }
  const { data, error } = await q
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      const e = new Error('expenses table missing')
      e.missingSchema = true
      throw e
    }
    throw error
  }
  return data
}

export async function updateExpense(id, patch) {
  const allowed = ['category', 'is_business', 'notes', 'tags', 'vendor']
  const update = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (k in patch) update[k] = patch[k]
  const { error } = await supabase.from('expenses').update(update).eq('id', id)
  if (error) throw error
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw error
}

// Monthly summary for the P&L view.
// Returns: [{ month: 'YYYY-MM', total, by_category: { cat: amount, ... } }]
// Excludes is_business=false rows.
export async function getMonthlyExpenseSummaries() {
  const { data, error } = await supabase
    .from('expenses')
    .select('transaction_date, amount, category, is_business')
    .eq('is_business', true)
  if (error) {
    // 42P01 = postgres undefined_table; PGRST205 = PostgREST schema-cache miss.
    // Both mean "table not created yet" — degrade gracefully so the rest of the
    // finance page still renders.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      const e = new Error('expenses table missing')
      e.missingSchema = true
      throw e
    }
    throw error
  }
  const by = new Map()
  for (const r of data) {
    const month = r.transaction_date.slice(0, 7)
    const entry = by.get(month) || { month, total: 0, by_category: {} }
    const amount = Number(r.amount || 0)
    entry.total += amount
    entry.by_category[r.category] = (entry.by_category[r.category] || 0) + amount
    by.set(month, entry)
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month))
}
