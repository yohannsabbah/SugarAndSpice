import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { isAdmin } from '@/lib/admin'
import { setItemCategory } from '@/lib/db/items'
import { ITEM_CATEGORY_LABEL } from '@/lib/itemCategories'

// PATCH /api/admin/items/[id]
//   body: { category }
export async function PATCH(req, { params }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!(body.category in ITEM_CATEGORY_LABEL)) {
    return NextResponse.json({ error: `Unknown category: ${body.category}` }, { status: 400 })
  }

  try {
    const row = await setItemCategory(id, body.category)
    if (!row) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    // The Wolt page caches item categories under this tag. Expire it now so
    // the next visit shows the new category.
    revalidateTag('wolt-data', { expire: 0 })
    return NextResponse.json({ ok: true, row })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
