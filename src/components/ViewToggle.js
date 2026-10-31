import Link from 'next/link'

// Table / Chart switch. Writes ?<param>=chart, or removes it for the table.
// Links keep the other params, so the ranges of the other cards stay.
export default function ViewToggle({ view, searchParams, param = 'view', basePath = '/admin' }) {
  const hrefFor = (v) => {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(([, value]) => typeof value === 'string'),
    )
    if (v === 'table') params.delete(param)
    else params.set(param, v)
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }
  const item = (v, label) => (
    <Link
      href={hrefFor(v)}
      scroll={false}
      aria-current={view === v ? 'page' : undefined}
      style={{
        padding: '6px 14px',
        fontSize: '0.85rem',
        fontWeight: 600,
        borderRadius: 8,
        background: view === v ? 'var(--brand-blue-bg)' : 'transparent',
        color: view === v ? 'var(--brand-blue-dark)' : 'var(--fg-muted)',
      }}
    >
      {label}
    </Link>
  )
  return (
    <div className="row" style={{ gap: 2, padding: 2, border: '1px solid var(--border)', borderRadius: 10 }}>
      {item('table', 'Table')}
      {item('chart', 'Chart')}
    </div>
  )
}
