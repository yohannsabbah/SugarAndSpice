// Wolt bills in fixed half-month periods: 1st–15th and 16th–end of each
// month, numbered 1..24 per year (period 1 = Jan 1-15, period 2 = Jan
// 16-31, ... period 24 = Dec 16-31).
export function periodNumForDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return { year: y, num: (m - 1) * 2 + (d <= 15 ? 1 : 2) }
}

// Inverse of periodNumForDate — the calendar date range a given
// (year, num) covers. Used to stub out a period's dates when the CSV
// purchases file arrives before any of that period's PDFs do.
export function periodDates(year, num) {
  const month = Math.ceil(num / 2)
  const isFirstHalf = num % 2 === 1
  const lastDay = new Date(year, month, 0).getDate()
  const mm = String(month).padStart(2, '0')
  return {
    start: isFirstHalf ? `${year}-${mm}-01` : `${year}-${mm}-16`,
    end: isFirstHalf ? `${year}-${mm}-15` : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}
