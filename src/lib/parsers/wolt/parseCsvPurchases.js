import Papa from 'papaparse'
import { fixHebrewMojibake } from './parseCsvItems.js'

// "DD/MM/YYYY, HH:MM" -> "YYYY-MM-DDTHH:MM:00"
function parseTimestamp(s) {
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi] = m
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:00`
}

// "1x ITEM NAME 31 ILS, 2x OTHER 21 ILS" -> [{ qty, name, unit_price }]
function parseItemsField(raw) {
  if (!raw) return []
  // Split on comma, but be lenient — item names sometimes contain "," especially
  // after the mojibake fix when names include "עוגת חצי קילו, מוצ' ..." etc.
  // The reliable separator is the pattern " <digits>x " at the start of each item.
  const fixed = fixHebrewMojibake(raw)
  // Find every "Nx ... <NUMBER> ILS" segment by regex.
  const re = /(\d+)x\s+(.+?)\s+(\d+(?:\.\d+)?)\s+ILS(?=,\s*\d+x\s|$)/g
  const out = []
  let m
  while ((m = re.exec(fixed)) !== null) {
    const qty = Number(m[1])
    const name = m[2].trim()
    const unit = Number(m[3])
    if (qty > 0 && name && Number.isFinite(unit)) {
      out.push({ quantity: qty, item_name: name, unit_price_incl_vat: unit, line_total_incl_vat: +(qty * unit).toFixed(2) })
    }
  }
  return out
}

const TYPE_MAP = {
  'wolt delivery': 'delivery',
  'takeaway': 'pickup',
  'eat in': 'pickup',
}

export function parseCsvPurchases(csvText) {
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  return data
    .map((row) => {
      const placedAt = parseTimestamp(row['Order placed'])
      const deliveredAt = parseTimestamp(row['Delivery time'])
      const rawType = (row['Delivery type'] || '').toLowerCase().trim()
      const channel = TYPE_MAP[rawType] || (rawType.includes('delivery') ? 'delivery' : 'pickup')
      const status = (row['Delivery status'] || '').toLowerCase().trim() || 'delivered'
      const orderNoPublic = (row['Order number'] || '').trim() || null
      const price = Number(row['Price']) || null
      const attribStr = row['Review attributions'] || ''
      const reviewScoreRaw = (row['Review score'] || '').trim()

      return {
        order_no_public: orderNoPublic,
        placed_at: placedAt,
        delivered_at: deliveredAt,
        status,
        channel,
        price_incl_vat: price,
        review_score: reviewScoreRaw ? Number(reviewScoreRaw) : null,
        review_comment: fixHebrewMojibake(row['Review comment'] || '').trim() || null,
        review_attributions: attribStr ? attribStr.split(',').map((s) => s.trim()).filter(Boolean) : null,
        items: parseItemsField(row['Items'] || ''),
      }
    })
    .filter((r) => r.placed_at && r.order_no_public)
}
