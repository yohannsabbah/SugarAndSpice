import { NextResponse } from 'next/server'
import { setAdminCookie, verifyPassword } from '@/lib/admin'

export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  if (!verifyPassword(body.password)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }
  await setAdminCookie()
  return NextResponse.json({ ok: true })
}
