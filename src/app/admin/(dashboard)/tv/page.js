'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

function detectType(item) {
  if (item?.type) return item.type
  const name = String(item?.url || item?.file || '').toLowerCase()
  if (/\.(mov|mp4|webm|ogg|m4v)$/.test(name)) return 'video'
  return 'image'
}

function resolveUrl(item, baseUrl) {
  if (item?.url) return item.url
  return (baseUrl || '') + (item?.file || '')
}

const POSITIONS = ['top', 'middle', 'bottom']
const SIZES = ['small', 'medium', 'large']
const ALIGNS = ['left', 'center', 'right']
const COLOR_PRESETS = ['#ffffff', '#000000', '#e89bb0', '#5a9cc4', '#f5d76e']
const DAYS = [
  { v: 0, label: 'Sun' },
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
]

export default function TvAdminPage() {
  const [baseUrl, setBaseUrl] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const fileInputRef = useRef(null)

  function toggleExpanded(i) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  useEffect(() => {
    fetch('/api/tv/media', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => {
        setBaseUrl(d.baseUrl || '')
        setItems(d.items || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const cleaned = items.map((it) => {
        const out = { ...it }
        if (!out.text) {
          delete out.text
          delete out.textPosition
          delete out.textSize
          delete out.textAlign
          delete out.textColor
          delete out.textStrip
          delete out.textOverflow
        }
        if (!out.hidden) delete out.hidden
        if (Array.isArray(out.days) && (out.days.length === 0 || out.days.length === DAYS.length)) {
          delete out.days
        }
        if (out.hourStart == null || out.hourStart === 0) delete out.hourStart
        if (out.hourEnd == null || out.hourEnd === 24) delete out.hourEnd
        return out
      })
      const res = await fetch('/api/tv/media', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, items: cleaned }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  function toggleDay(i, day) {
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it
        const current = Array.isArray(it.days) && it.days.length > 0 ? it.days : DAYS.map((d) => d.v)
        const has = current.includes(day)
        const next = has ? current.filter((d) => d !== day) : [...current, day].sort()
        if (next.length === 0 || next.length === DAYS.length) {
          const { days, ...rest } = it
          return next.length === 0 ? { ...rest, days: [] } : rest
        }
        return { ...it, days: next }
      }),
    )
  }

  function clearText(i) {
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it
        const { text, textPosition, textSize, textAlign, textColor, textStrip, textOverflow, ...rest } = it
        return rest
      }),
    )
  }

  function deleteItem(i) {
    const it = items[i]
    if (!confirm(`Remove "${it.file || it.url}" from the slideshow?`)) return
    setItems((prev) => prev.filter((_, idx) => idx !== i))
    setExpanded((prev) => {
      const next = new Set()
      for (const idx of prev) {
        if (idx < i) next.add(idx)
        else if (idx > i) next.add(idx - 1)
      }
      return next
    })
  }

  function moveItem(i, direction) {
    const j = i + direction
    if (j < 0 || j >= items.length) return
    setItems((prev) => {
      const copy = [...prev]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
    setExpanded((prev) => {
      const next = new Set(prev)
      const hasI = next.has(i)
      const hasJ = next.has(j)
      next.delete(i)
      next.delete(j)
      if (hasI) next.add(j)
      if (hasJ) next.add(i)
      return next
    })
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const presign = await fetch('/api/tv/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      const presignData = await presign.json()
      if (!presign.ok) throw new Error(presignData.error || 'Upload presign failed')

      const put = await fetch(presignData.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('S3 upload failed (' + put.status + ')')

      setItems((prev) => [...prev, { file: presignData.file }])
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}
        >
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>TV slideshow</h2>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {savedFlash && (
              <span className="muted" style={{ fontSize: '0.85rem' }}>Saved ✓</span>
            )}
            <Link
              href="/tv"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            >
              Open /tv ↗
            </Link>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/ogg"
              onChange={handleUpload}
              style={{ display: 'none' }}
            />
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              onClick={handleSave}
              disabled={loading || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
          Edit text overlays below and click Save. Changes are stored in S3 and the TV will see them on next reload.
        </div>
        {error && <div className="error">{error}</div>}
        {loading && <div className="muted">Loading…</div>}
        {!loading && items.length === 0 && <div className="muted">No items.</div>}
        {!loading && items.length > 0 && (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {items.map((item, i) => {
              const url = resolveUrl(item, baseUrl)
              const type = detectType(item)
              return (
                <li
                  key={url}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 120px 1fr',
                    gap: 16,
                    alignItems: 'flex-start',
                    padding: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'var(--bg-card)',
                  }}
                >
                  <div className="muted" style={{ fontWeight: 700, fontSize: '0.95rem', paddingTop: 4 }}>
                    {i + 1}
                  </div>
                  <div
                    style={{
                      width: 120,
                      height: 80,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {type === 'video' ? (
                      <video
                        src={url}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <img
                        src={url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, opacity: item.hidden ? 0.5 : 1 }}>
                          {item.file || item.url}
                        </span>
                        <span className="badge">{type}</span>
                        {item.hidden && <span className="badge" style={{ background: 'var(--brand-pink-bg)', color: 'var(--brand-pink-dark)' }}>Hidden</span>}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!item.hidden}
                            onChange={(e) => updateItem(i, { hidden: e.target.checked })}
                          />
                          Hide
                        </label>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: '0.9rem', lineHeight: 1 }}
                          onClick={() => moveItem(i, -1)}
                          disabled={i === 0}
                          aria-label="Move up"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: '0.9rem', lineHeight: 1 }}
                          onClick={() => moveItem(i, 1)}
                          disabled={i === items.length - 1}
                          aria-label="Move down"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          onClick={() => toggleExpanded(i)}
                        >
                          {expanded.has(i) ? 'Collapse' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          onClick={() => deleteItem(i)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {!expanded.has(i) && item.text && (
                      <div className="muted" style={{ fontSize: '0.85rem', fontStyle: 'italic', whiteSpace: 'pre-line' }}>
                        “{item.text}” — {item.textPosition || 'bottom'}, {item.textSize || 'medium'}, {item.textAlign || 'center'}
                      </div>
                    )}
                    {expanded.has(i) && (
                      <>
                    <textarea
                      className="input"
                      placeholder="Optional text overlay — press Enter for a new line"
                      value={item.text || ''}
                      onChange={(e) => updateItem(i, { text: e.target.value })}
                      rows={2}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    {item.text && (
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="muted" style={{ fontSize: '0.75rem' }}>Position</span>
                          <select
                            className="input"
                            value={item.textPosition || 'bottom'}
                            onChange={(e) => updateItem(i, { textPosition: e.target.value })}
                          >
                            {POSITIONS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="muted" style={{ fontSize: '0.75rem' }}>Size</span>
                          <select
                            className="input"
                            value={item.textSize || 'medium'}
                            onChange={(e) => updateItem(i, { textSize: e.target.value })}
                          >
                            {SIZES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="muted" style={{ fontSize: '0.75rem' }}>Align</span>
                          <select
                            className="input"
                            value={item.textAlign || 'center'}
                            onChange={(e) => updateItem(i, { textAlign: e.target.value })}
                          >
                            {ALIGNS.map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="muted" style={{ fontSize: '0.75rem' }}>Color</span>
                          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                            <input
                              type="color"
                              value={item.textColor || '#ffffff'}
                              onChange={(e) => updateItem(i, { textColor: e.target.value })}
                              style={{ width: 40, height: 36, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'none' }}
                            />
                            {COLOR_PRESETS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                aria-label={c}
                                onClick={() => updateItem(i, { textColor: c })}
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: c,
                                  border: '1px solid var(--border)',
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', padding: '6px 0', fontSize: '0.9rem' }}>
                          <input
                            type="checkbox"
                            checked={item.textStrip === true}
                            onChange={(e) => updateItem(i, { textStrip: e.target.checked })}
                          />
                          Background strip
                        </label>
                        <label
                          style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', padding: '6px 0', fontSize: '0.9rem' }}
                          title="Place text outside the image (in the empty space above/below). Only applies to top/bottom positions when the image leaves space."
                        >
                          <input
                            type="checkbox"
                            checked={item.textOverflow !== false}
                            onChange={(e) => updateItem(i, { textOverflow: e.target.checked })}
                            disabled={item.textPosition === 'middle'}
                          />
                          Outside image
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '6px 12px', fontSize: '0.85rem', alignSelf: 'flex-end' }}
                          onClick={() => clearText(i)}
                        >
                          Clear text
                        </button>
                      </div>
                    )}
                    <fieldset
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '8px 12px 12px',
                        margin: 0,
                      }}
                    >
                      <legend className="muted" style={{ padding: '0 6px', fontSize: '0.8rem' }}>
                        Schedule (leave open for always)
                      </legend>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {DAYS.map(({ v, label }) => {
                          const active = !Array.isArray(item.days) || item.days.length === 0 || item.days.includes(v)
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => toggleDay(i, v)}
                              style={{
                                padding: '4px 10px',
                                fontSize: '0.8rem',
                                borderRadius: 999,
                                border: '1px solid var(--border)',
                                background: active ? 'var(--brand-blue)' : 'transparent',
                                color: active ? '#fff' : 'var(--muted)',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>From</span>
                        <select
                          className="input"
                          style={{ width: 110 }}
                          value={item.hourStart ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value)
                            updateItem(i, { hourStart: v })
                          }}
                        >
                          <option value="">always</option>
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                          ))}
                        </select>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>to</span>
                        <select
                          className="input"
                          style={{ width: 110 }}
                          value={item.hourEnd ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value)
                            updateItem(i, { hourEnd: v })
                          }}
                        >
                          <option value="">always</option>
                          {Array.from({ length: 24 }, (_, i2) => {
                            const h = i2 + 1
                            return (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                            )
                          })}
                        </select>
                      </div>
                    </fieldset>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                      <a
                        href={`/tv?num=${i + 1}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{ padding: '6px 18px', fontSize: '0.9rem' }}
                      >
                        Preview ↗
                      </a>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '6px 18px', fontSize: '0.9rem' }}
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save'}
                      </button>
                    </div>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {!loading && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '32px 12px',
              border: '2px dashed var(--border)',
              borderRadius: 10,
              background: 'transparent',
              color: 'var(--brand-blue)',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: uploading ? 'progress' : 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!uploading) e.currentTarget.style.borderColor = 'var(--brand-blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>+</span>
            <span>{uploading ? 'Uploading…' : 'Upload media'}</span>
            <span className="muted" style={{ fontSize: '0.75rem', fontWeight: 400 }}>
              JPEG, PNG, WebP, GIF, MP4, WebM, MOV
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
