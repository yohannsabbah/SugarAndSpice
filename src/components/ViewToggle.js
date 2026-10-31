import Link from 'next/link'

const VIEWS = [['table', 'Table'], ['chart', 'Chart']]

// A row of links that sets one URL param: Table / Chart by default, or any
// `options` as [value, label]. The default value removes the param. Links keep
// the other params, so the other cards stay as they are.
export default function ViewToggle({
  view, searchParams, param = 'view', basePath = '/admin', options = VIEWS, defaultValue = options[0][0],
}) {
  const hrefFor = (v) => {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(([, value]) => typeof value === 'string'),
    )
    if (v === defaultValue) params.delete(param)
    else params.set(param, v)
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }
  const item = (v, label) => (
    <Link
      key={v}
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
      {options.map(([v, label]) => item(v, label))}
    </div>
  )
}
