import { NextResponse } from 'next/server'
import { addEmployee, listEmployees } from '@/lib/db/employees'
import { isAdmin } from '@/lib/admin'

export async function GET(req) {
  const url = new URL(req.url)
  const includeInactive = url.searchParams.get('all') === '1'
  if (includeInactive && !(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const employees = await listEmployees({ includeInactive })
  return NextResponse.json({ employees })
}

export async function POST(req) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  const employee = await addEmployee(body.name)
  return NextResponse.json({ employee }, { status: 201 })
}
