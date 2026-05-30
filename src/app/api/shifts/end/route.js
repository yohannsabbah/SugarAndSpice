import { NextResponse } from 'next/server'
import { endShift, getOpenShift } from '@/lib/db/shifts'

export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  let shiftId = body.shift_id
  if (!shiftId) {
    if (!body.employee_id) {
      return NextResponse.json(
        { error: 'shift_id or employee_id is required' },
        { status: 400 },
      )
    }
    const open = await getOpenShift(body.employee_id)
    if (!open) {
      return NextResponse.json({ error: 'No open shift to end' }, { status: 404 })
    }
    shiftId = open.id
  }
  const shift = await endShift(shiftId)
  if (!shift) {
    return NextResponse.json({ error: 'Shift not found or already ended' }, { status: 404 })
  }
  return NextResponse.json({ shift })
}
