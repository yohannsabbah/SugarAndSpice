import { NextResponse } from 'next/server'
import { startShift } from '@/lib/db/shifts'
import { getEmployee } from '@/lib/db/employees'

export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  if (!body.employee_id) {
    return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
  }
  const employee = await getEmployee(body.employee_id)
  if (!employee || !employee.active) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  const shift = await startShift(body.employee_id)
  return NextResponse.json({ shift })
}
