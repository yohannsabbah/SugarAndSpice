// Month arithmetic for receipts, in Israel time. Pure: no server-only imports,
// so the verify scripts can load it.
//
// A receipt belongs to the month of its printed date, or, when the date could
// not be read, to the month it was uploaded in Israel. The page, the CSV and
// the ZIP all filter through receiptMonthBounds so they always agree.

const ZONE = 'Asia/Jerusalem'

const OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' })
const YEAR_MONTH = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit' })

function pad(n) {
  return String(n).padStart(2, '0')
}

// Israel's UTC offset in minutes at an instant, e.g. 180 in summer.
function israelOffsetMinutes(instant) {
  const name = OFFSET.formatToParts(instant).find((p) => p.type === 'timeZoneName').value // "GMT+03:00"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

// UTC instant of 00:00 Israel time on the 1st of the month. Clocks never change
// on the 1st, so the offset at UTC midnight is the offset at Israel midnight.
function israelMonthStart(year, month) {
  const utcMidnight = new Date(Date.UTC(year, month - 1, 1))
  return new Date(utcMidnight.getTime() - israelOffsetMinutes(utcMidnight) * 60_000)
}

export function receiptMonthBounds(month) {
  const [year, m] = month.split('-').map(Number)
  const nextYear = m === 12 ? year + 1 : year
  const nextMonth = m === 12 ? 1 : m + 1
  return {
    dateFrom: `${year}-${pad(m)}-01`,
    dateTo: `${nextYear}-${pad(nextMonth)}-01`,
    uploadedFrom: israelMonthStart(year, m).toISOString(),
    uploadedTo: israelMonthStart(nextYear, nextMonth).toISOString(),
  }
}

export function currentIsraelMonth(now = new Date()) {
  const parts = Object.fromEntries(YEAR_MONTH.formatToParts(now).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}`
}

// The month a receipt belongs to, by the rule at the top of this file.
export function receiptMonth(row) {
  return row.purchased_at ? row.purchased_at.slice(0, 7) : currentIsraelMonth(new Date(row.uploaded_at))
}
