'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Reads receipts still pending (from any month) while the owner has the page
// open, a few per request, then reloads the table. Stops at the first failed
// request or when a request reads nothing, so it never loops.
export default function PendingSweeper({ pendingCount }) {
  const router = useRouter()
  const [left, setLeft] = useState(pendingCount)
  const started = useRef(false)

  // One sweep per mount. The ref keeps React's dev-mode second effect run from
  // starting a parallel sweep.
  useEffect(() => {
    if (pendingCount === 0 || started.current) return
    started.current = true
    ;(async () => {
      for (;;) {
        const res = await fetch('/api/admin/receipts/extract-pending', { method: 'POST' }).catch(() => null)
        const j = res?.ok ? await res.json().catch(() => null) : null
        if (!j) break
        setLeft(j.remaining)
        if (j.remaining === 0 || j.processed === 0) break
      }
      setLeft(0)
      router.refresh()
    })()
  }, [pendingCount, router])

  if (left === 0) return null
  return (
    <div className="card muted">
      Reading {left} receipt{left === 1 ? '' : 's'}…
    </div>
  )
}
