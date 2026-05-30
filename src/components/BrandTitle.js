import Link from 'next/link'

export default function BrandTitle({ subtitle, href = '/' }) {
  const inner = (
    <div className="brand-bar">
      <img src="/logo.png" alt="Sugar & Spice — special cafe" className="brand-bar-logo" />
      {subtitle && <span className="brand-bar-subtitle">{subtitle}</span>}
    </div>
  )
  return href ? (
    <Link href={href} className="brand-bar-link">
      {inner}
    </Link>
  ) : (
    inner
  )
}
