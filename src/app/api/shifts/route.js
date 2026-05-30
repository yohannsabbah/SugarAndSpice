import { NextResponse } from 'next/server'
import { createShift, listShifts } from '@/lib/db/shifts'
import { isAdmin } from '@/lib/admin'

export async function GET(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const employeeId = url.searchParams.get('employee_id') || undefined
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const shifts = await listShifts({ employeeId, from, to })
  return NextResponse.json({ shifts })
}

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  if (!body.employee_id || !body.started_at) {
    return NextResponse.json(
      { error: 'employee_id and started_at are required' },
      { status: 400 },
    )
  }
  const shift = await createShift({
    employee_id: body.employee_id,
    started_at: body.started_at,
    ended_at: body.ended_at,
    note: body.note,
  })
  return NextResponse.json({ shift }, { status: 201 })
}
