// Wolt bills in fixed half-month periods: 1st–15th and 16th–end of each
// month, numbered 1..24 per year (period 1 = Jan 1-15, period 2 = Jan
// 16-31, ... period 24 = Dec 16-31).
export function periodNumForDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return { year: y, num: (m - 1) * 2 + (d <= 15 ? 1 : 2) }
}
