'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BrandTitle from '@/components/BrandTitle'

function AdminLoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/admin'
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Login failed')
      router.replace(next)
      router.refresh()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <div className="stack">
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}

export default function AdminLoginPage() {
  return (
    <div className="container">
      <BrandTitle subtitle="admin login" href={null} />
      <Suspense fallback={<div className="card muted">Loading…</div>}>
        <AdminLoginForm />
      </Suspense>
    </div>
  )
}
