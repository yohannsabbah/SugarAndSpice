import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin'
import { deleteOtherIncome } from '@/lib/db/otherIncome'

// DELETE /api/admin/other-income/[id]
export async function DELETE(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    await deleteOtherIncome(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
