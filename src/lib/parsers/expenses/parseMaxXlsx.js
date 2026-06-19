import * as XLSX from 'xlsx'

// MAX (Israeli Visa) transaction-details export. Layout (in order):
//   Row 0:  Cardholder name + ID         (e.g. "ג'ניפר אסתר סבח-324478981")
//   Row 1:  Card label                   (e.g. "6410-MAX Back Total" OR "כל הכרטיסים (2)")
//   Row 2:  Billing period               (e.g. "06/2026")
//   Row 3:  Column headers
//   Row 4+: Data rows
//   Last 3 rows: blank | "סך הכל" | "<total>₪"
//
// Columns (by index):
//   0  תאריך עסקה               transaction date (DD-MM-YYYY)
//   1  שם בית העסק              vendor / merchant name
//   2  קטגוריה                  category as labelled by MAX (in Hebrew)
//   3  4 ספרות אחרונות          card last 4 digits
//   4  סוג עסקה                  transaction type (Hebrew)
//   5  סכום חיוב                 charge amount (NIS)
//   6  מטבע חיוב                 charge currency
//   7  סכום עסקה מקורי           original transaction amount
//   8  מטבע עסקה מקורי           original currency
//   9  תאריך חיוב                billing date (DD-MM-YYYY)
//   10 הערות                    notes
//   11 תיוגים                    tags
//   12 מועדון הנחות              discount club
//   13 מפתח דיסקונט              discount key
//   14 אופן ביצוע ההעסקה          execution method (Hebrew: contactless / phone / mobile)
//   15 שער המרה                  exchange rate

const TX_TYPE_MAP = {
  'רגילה': 'regular',
  'עסקת 30 פלוס': 'deferred_30',
  'תשלומים': 'installments',
  'חיוב חוזר': 'recurring',
  'חיוב חודשי': 'recurring',
}

function parseDate(s) {
  // 'DD-MM-YYYY' → 'YYYY-MM-DD'
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function normalizeVendor(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/["'״׳]+/g, '')
    .toLowerCase()
}

// Returns:
//   { meta: { cardholder, card_label, period_label, total_amount }, rows: [...] }
//
// Each row:
//   { transaction_date, billing_date, vendor, vendor_normalized,
//     amount, currency, amount_original, currency_original,
//     card_last4, transaction_type, source_category, notes, execution }
export function parseMaxXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const meta = {
    cardholder: String(grid[0]?.[0] || '').trim(),
    card_label: String(grid[1]?.[0] || '').trim(),
    period_label: String(grid[2]?.[0] || '').trim(),
    total_amount: null,
  }

  // Find the total at the bottom: format is "<number>₪"
  for (let i = grid.length - 1; i >= Math.max(0, grid.length - 6); i--) {
    const cell = String(grid[i]?.[0] || '').trim()
    const m = /^([\d,]+(?:\.\d+)?)\s*₪/.exec(cell)
    if (m) { meta.total_amount = Number(m[1].replace(/,/g, '')); break }
  }

  // Data rows start after the header row (3). Walk until we hit a blank/totals row.
  const rows = []
  for (let i = 4; i < grid.length; i++) {
    const r = grid[i]
    const txDate = parseDate(r[0])
    const vendor = String(r[1] || '').trim()
    const amount = Number(r[5])
    if (!txDate || !vendor || !Number.isFinite(amount) || amount === 0) continue

    rows.push({
      transaction_date: txDate,
      billing_date: parseDate(r[9]),
      vendor,
      vendor_normalized: normalizeVendor(vendor),
      source_category: String(r[2] || '').trim() || null,
      card_last4: String(r[3] || '').trim() || null,
      transaction_type: TX_TYPE_MAP[String(r[4] || '').trim()] || (String(r[4] || '').trim() || null),
      amount,
      currency: String(r[6] || 'ILS').replace('₪', 'ILS').trim() || 'ILS',
      amount_original: Number(r[7]) || null,
      currency_original: String(r[8] || '').replace('₪', 'ILS').trim() || null,
      notes: String(r[10] || '').trim() || null,
      execution: String(r[14] || '').trim() || null,
    })
  }

  return { meta, rows }
}
