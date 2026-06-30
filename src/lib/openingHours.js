// Shop opening hours (local time). Saturday is closed.
// day: 0 = Sunday … 6 = Saturday
const OPENING_HOURS = {
  0: { open: [10, 30], close: [21, 30] },
  1: { open: [10, 30], close: [21, 30] },
  2: { open: [10, 30], close: [21, 30] },
  3: { open: [10, 30], close: [21, 30] },
  4: { open: [10, 30], close: [23, 30] },
  5: { open: [10, 0], close: [18, 0] },
}

const START_GRACE_MINUTES = 15

function toMinutes([h, m]) {
  return h * 60 + m
}

function localMinutes(iso) {
  const d = new Date(iso)
  return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() }
}

export function getOpeningForDay(day) {
  return OPENING_HOURS[day] ?? null
}

export function openingDurationMs(day) {
  const hours = getOpeningForDay(day)
  if (!hours) return 0
  return (toMinutes(hours.close) - toMinutes(hours.open)) * 60_000
}

export function totalOpeningMsInMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  let total = 0
  for (let d = 1; d <= daysInMonth; d++) {
    total += openingDurationMs(new Date(y, m - 1, d).getDay())
  }
  return total
}

export function formatOpeningTime([h, m]) {
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function openingHoursLabel(day) {
  const hours = getOpeningForDay(day)
  if (!hours) return 'Closed'
  return `${formatOpeningTime(hours.open)} – ${formatOpeningTime(hours.close)}`
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function openingHoursSchedule() {
  return DAY_NAMES.map((name, day) => ({ day, name, label: openingHoursLabel(day) }))
}

export function getShiftOpeningIssues(startedAt, endedAt) {
  if (!startedAt) return []

  const issues = []
  const start = localMinutes(startedAt)
  const startSchedule = getOpeningForDay(start.day)

  if (!startSchedule) {
    issues.push('Shift starts on a closed day')
    return issues
  }

  const openMin = toMinutes(startSchedule.open)
  const closeMin = toMinutes(startSchedule.close)

  if (start.minutes < openMin - START_GRACE_MINUTES) {
    issues.push(`Starts before opening (${openingHoursLabel(start.day)})`)
  }
  if (start.minutes > closeMin) {
    issues.push(`Starts after closing (${openingHoursLabel(start.day)})`)
  }

  if (!endedAt) return issues

  const end = localMinutes(endedAt)
  const endSchedule = getOpeningForDay(end.day)

  if (!endSchedule) {
    issues.push('Shift ends on a closed day')
    return issues
  }

  const endCloseMin = toMinutes(endSchedule.close)
  if (end.minutes > endCloseMin) {
    issues.push(`Ends after closing (${openingHoursLabel(end.day)})`)
  }

  const endOpenMin = toMinutes(endSchedule.open)
  if (end.day !== start.day && end.minutes < endOpenMin - START_GRACE_MINUTES) {
    issues.push(`Ends before opening (${openingHoursLabel(end.day)})`)
  }

  return issues
}

export function isShiftOutsideOpeningHours(startedAt, endedAt) {
  return getShiftOpeningIssues(startedAt, endedAt).length > 0
}
