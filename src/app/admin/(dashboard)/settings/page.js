import { listItemsWithSales } from '@/lib/db/items'
import ItemCategoriesCard from './ItemCategoriesCard'
import '../wolt/wolt.css'
import '../nayax/nayax.css'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const items = await listItemsWithSales()
  return (
    <div className="stack" style={{ gap: 20 }}>
      <ItemCategoriesCard items={items} />
    </div>
  )
}
