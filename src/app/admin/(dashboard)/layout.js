import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin'
import BrandTitle from '@/components/BrandTitle'
import LogoutButton from './LogoutButton'

export default async function DashboardLayout({ children }) {
  if (!(await isAdmin())) {
    redirect('/admin/login')
  }

  return (
    <div className="container-wide">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <BrandTitle subtitle="admin" />
        <LogoutButton />
      </div>
      <nav
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'nowrap',
          alignItems: 'center',
          marginBottom: 20,
          overflowX: 'auto',
        }}
      >
        <NavLink href="/admin">Overview</NavLink>
        <NavLink href="/admin/employees">Employees</NavLink>
        <NavLink href="/admin/shifts">Shifts</NavLink>
        <NavLink href="/admin/sales">Sales</NavLink>
      </nav>
      {children}
    </div>
  )
}

function NavLink({ href, children }) {
  return (
    <Link
      href={href}
      style={{
        padding: '10px 16px',
        borderRadius: 10,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        fontWeight: 600,
        fontSize: '0.95rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </Link>
  )
}
