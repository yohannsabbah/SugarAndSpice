// Month ranges for the overview cards. All months are 'YYYY-MM'.

const YM = /^\d{4}-\d{2}$/
// The business's first month. A range never goes earlier.
export const FIRST_MONTH = '2026-01'
// Months a range shows by default, counting the current month.
export const DEFAULT_MONTHS = 6

function ym(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// Every 'YYYY-MM' from `from` to `to`, oldest first.
export function monthsBetween(from, to) {
  const months = []
  let [y, m] = from.split('-').map(Number)
  for (let key = from; key <= to; ) {
    months.push(key)
    m += 1
    if (m > 12) { m = 1; y += 1 }
    key = `${y}-${String(m).padStart(2, '0')}`
  }
  return months
}

// Reads a range from two URL params. The range defaults to the last
// DEFAULT_MONTHS months and can reach back to FIRST_MONTH.
// Returns { from, to, defaultFrom, currentMonth }.
export function resolveMonthRange(fromParam, toParam) {
  const now = new Date()
  const currentMonth = ym(now)
  const back = ym(new Date(now.getFullYear(), now.getMonth() - (DEFAULT_MONTHS - 1), 1))
  const defaultFrom = back > FIRST_MONTH ? back : FIRST_MONTH
  const inRange = (v) => YM.test(v || '') && v >= FIRST_MONTH && v <= currentMonth
  let from = inRange(fromParam) ? fromParam : defaultFrom
  let to = inRange(toParam) ? toParam : currentMonth
  if (from > to) [from, to] = [to, from]
  return { from, to, defaultFrom, currentMonth }
}
