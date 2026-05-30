import { NextResponse } from 'next/server'
import { deleteEmployee, updateEmployee } from '@/lib/db/employees'
import { isAdmin } from '@/lib/admin'

export async function PATCH(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const patch = {}
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if (typeof body.active === 'boolean') patch.active = body.active
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  const employee = await updateEmployee(id, patch)
  return NextResponse.json({ employee })
}

export async function DELETE(_req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await deleteEmployee(id)
  return NextResponse.json({ ok: true })
}
