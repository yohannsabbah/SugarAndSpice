'use client'

import { useEffect, useRef, useState } from 'react'
import { downscaleToJpeg, sha256Hex } from '@/lib/receipts/prepareImage'
import { LAST_EMPLOYEE_KEY } from '@/lib/storageKeys'

const DONE_MS = 2500

const LABEL = {
  idle: '📷 Receipt',
  working: 'Uploading…',
  done: '✓ Done',
  error: 'Try again',
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Upload failed')
  return d
}

function lastEmployeeId() {
  try {
    return localStorage.getItem(LAST_EMPLOYEE_KEY)
  } catch {
    return null
  }
}

// The whole upload, from the picked file to the stored row. A duplicate photo
// skips the upload; the employee sees "Done" either way.
async function uploadReceipt(file) {
  const sha256 = await sha256Hex(file)
  const blob = await downscaleToJpeg(file)
  const presign = await postJson('/api/receipts/upload-url', { sha256, size: blob.size })
  if (presign.duplicate) return

  const put = await fetch(presign.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  if (!put.ok) throw new Error('Upload failed')

  await postJson('/api/receipts', {
    key: presign.key,
    sha256,
    fileName: file.name,
    employeeId: lastEmployeeId(),
  })
}

export default function ReceiptButton() {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const doneTimer = useRef(null)

  useEffect(() => () => clearTimeout(doneTimer.current), [])

  async function run() {
    setState('working')
    setError('')
    try {
      await uploadReceipt(fileRef.current)
      fileRef.current = null
      setState('done')
      doneTimer.current = setTimeout(() => setState('idle'), DONE_MS)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'No connection' : e.message)
      setState('error')
    }
  }

  function handleClick() {
    if (state === 'error' && fileRef.current) {
      run()
      return
    }
    inputRef.current?.click()
  }

  function handleChange(e) {
    const file = e.target.files?.[0]
    // Clear so the same file can be picked again later.
    e.target.value = ''
    if (!file) return
    clearTimeout(doneTimer.current)
    fileRef.current = file
    run()
  }

  return (
    <div className="receipt-button">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        hidden
      />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleClick}
        disabled={state === 'working'}
      >
        {LABEL[state]}
      </button>
      {state === 'error' && <div className="receipt-button-error">{error}</div>}
    </div>
  )
}
