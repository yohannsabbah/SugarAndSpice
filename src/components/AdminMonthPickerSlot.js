'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import MonthPicker from './MonthPicker'

// Show the month picker only on pages that actually filter by ?month=
const PATHS_WITH_MONTH = ['/admin', '/admin/wolt', '/admin/nayax', '/admin/finance', '/admin/expenses']

export default function AdminMonthPickerSlot() {
  const pathname = usePathname()
  const search = useSearchParams()
  if (!PATHS_WITH_MONTH.includes(pathname)) return null
  const value = search.get('month') || undefined
  return <MonthPicker value={value} />
}
