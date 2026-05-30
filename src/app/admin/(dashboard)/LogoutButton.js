'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleLogout() {
    setBusy(true)
    await fetch('/api/admin/logout', { method: 'POST' })
    router.replace('/admin/login')
    router.refresh()
  }

  return (
    <button className="btn btn-ghost" onClick={handleLogout} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
