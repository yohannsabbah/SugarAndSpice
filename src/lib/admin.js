import 'server-only'
import { createHash } from 'crypto'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'ss_admin'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function adminToken() {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw) throw new Error('ADMIN_PASSWORD is not set')
  return createHash('sha256').update(pw).digest('hex')
}

export function verifyPassword(password) {
  return (password || '') === process.env.ADMIN_PASSWORD
}

export async function setAdminCookie() {
  const c = await cookies()
  c.set(COOKIE_NAME, adminToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearAdminCookie() {
  const c = await cookies()
  c.delete(COOKIE_NAME)
}

export async function isAdmin() {
  const c = await cookies()
  const val = c.get(COOKIE_NAME)?.value
  if (!val) return false
  return val === adminToken()
}
