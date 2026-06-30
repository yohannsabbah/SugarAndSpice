export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function shiftDurationMs(startIso, endIso) {
  if (!startIso) return 0
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  return Math.max(0, end - start)
}

export function formatDuration(startIso, endIso) {
  if (!startIso) return '—'
  let ms = shiftDurationMs(startIso, endIso)
  const hours = Math.floor(ms / 3_600_000)
  ms -= hours * 3_600_000
  const minutes = Math.floor(ms / 60_000)
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

export function formatDurationFromMs(ms) {
  let remaining = Math.max(0, ms)
  const hours = Math.floor(remaining / 3_600_000)
  remaining -= hours * 3_600_000
  const minutes = Math.floor(remaining / 60_000)
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

// Returns "yyyy-MM-ddTHH:mm" for use in <input type="datetime-local">,
// rendered in the user's local timezone.
export function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputValue(v) {
  if (!v) return null
  return new Date(v).toISOString()
}
