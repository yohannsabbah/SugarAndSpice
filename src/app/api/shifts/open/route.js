import { NextResponse } from 'next/server'
import { getOpenShift } from '@/lib/db/shifts'

export async function GET(req) {
  const url = new URL(req.url)
  const employeeId = url.searchParams.get('employee_id')
  if (!employeeId) {
    return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })
  }
  const shift = await getOpenShift(employeeId)
  return NextResponse.json({ shift })
}
