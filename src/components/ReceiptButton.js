'use client'

import { useRef, useState } from 'react'
import { downscaleToJpeg, sha256Hex } from '@/lib/receipts/prepareImage'
import { LAST_EMPLOYEE_KEY } from '@/lib/storageKeys'

// Short and fixed: it sits in the top corner beside the logo, and the
// employee only needs to know the photo is not saved yet.
const ERROR_TEXT = 'Not saved'

const LABEL = {
  idle: '📷 Receipt',
  working: 'Uploading…',
  done: '✓ Done',
  error: 'Try again',
}

function lastEmployeeId() {
  try {
    return localStorage.getItem(LAST_EMPLOYEE_KEY)
  } catch {
    return null
  }
}

// The whole upload: one request to our server, which stores the photo in S3
// and records it. A duplicate photo also comes back OK, so the employee sees
// "Done" either way.
async function uploadReceipt(file) {
  let sha256, photo
  try {
    sha256 = await sha256Hex(file)
    photo = await downscaleToJpeg(file)
  } catch (e) {
    // The file itself is unreadable (not an image, or discarded by the phone).
    // Retrying the same file cannot succeed, so the caller drops it.
    e.unreadableFile = true
    throw e
  }

  const form = new FormData()
  form.append('photo', photo, 'receipt.jpg')
  form.append('sha256', sha256)
  form.append('fileName', file.name)
  const employeeId = lastEmployeeId()
  if (employeeId) form.append('employeeId', employeeId)

  const r = await fetch('/api/receipts', { method: 'POST', body: form })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d.error || `Upload failed (${r.status})`)
  }
}

export default function ReceiptButton() {
  const [state, setState] = useState('idle')
  const inputRef = useRef(null)
  const fileRef = useRef(null)

  async function run() {
    setState('working')
    try {
      await uploadReceipt(fileRef.current)
      fileRef.current = null
      setState('done')
    } catch (e) {
      console.warn('Receipt upload failed:', e)
      // Keep the file for a network retry. Drop an unreadable one, so the next
      // tap opens the picker instead of failing the same way forever.
      if (e.unreadableFile) fileRef.current = null
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
    fileRef.current = file
    run()
  }

  return (
    <div className="receipt-button">
      {/* No `capture` attribute: with it, phones open the camera directly and
          hide the photo library and files. Without it, iOS offers Take Photo /
          Photo Library / Choose File, and Android offers Camera / Files. */}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} hidden />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleClick}
        disabled={state === 'working'}
      >
        {LABEL[state]}
      </button>
      {state === 'error' && <div className="receipt-button-error">{ERROR_TEXT}</div>}
      {state === 'done' && <DoneDialog onClose={() => setState('idle')} />}
    </div>
  )
}

// Stays until the employee taps OK, so they know the photo is safe before
// they throw the paper away.
function DoneDialog({ onClose }) {
  return (
    <div className="receipt-done-backdrop">
      <div className="receipt-done-card" role="dialog" aria-modal="true" aria-labelledby="receipt-done-title">
        <div className="receipt-done-check" aria-hidden="true">✓</div>
        <div id="receipt-done-title" className="receipt-done-title">
          Great, thanks for uploading!
        </div>
        <button type="button" className="btn btn-success btn-lg btn-block" onClick={onClose} autoFocus>
          OK
        </button>
      </div>
    </div>
  )
}
