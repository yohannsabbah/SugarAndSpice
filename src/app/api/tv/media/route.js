import { NextResponse } from 'next/server'
import { readTvMedia, writeTvMedia } from '@/lib/tv-storage'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await readTvMedia()
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'Expected { baseUrl, items: [...] }' }, { status: 400 })
  }
  try {
    await writeTvMedia(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
