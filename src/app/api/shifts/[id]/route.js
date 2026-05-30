import { NextResponse } from 'next/server'
import { deleteShift, updateShift } from '@/lib/db/shifts'
import { isAdmin } from '@/lib/admin'

export async function PATCH(req, { params }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const admin = await isAdmin()
  const byEmployee = !admin && body.by_employee === true

  if (!admin && !byEmployee) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const patch = {}
  if (typeof body.started_at === 'string') patch.started_at = body.started_at
  if ('ended_at' in body) patch.ended_at = body.ended_at
  if (typeof body.note === 'string') patch.note = body.note
  if (admin && typeof body.employee_id === 'string') patch.employee_id = body.employee_id

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const shift = await updateShift(id, patch, { byEmployee })
  return NextResponse.json({ shift })
}

export async function DELETE(_req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await deleteShift(id)
  return NextResponse.json({ ok: true })
}
