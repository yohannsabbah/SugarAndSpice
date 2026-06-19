// Nayax SSRS exports arrive UTF-8 but the byte stream was misinterpreted
// upstream, so Hebrew + emoji appear as mojibake when read as UTF-8.
// Re-decoding as latin1 → utf-8 restores the original characters.
//
// Same approach as src/lib/parsers/wolt/parseCsvItems.js — kept here so the
// Nayax parsers stay self-contained.
export function fixMojibake(s) {
  if (s == null) return s
  // Already-valid Hebrew or emoji: leave alone.
  if (/[֐-׿]|[\u{1F300}-\u{1FAFF}]/u.test(s)) return s
  try {
    const bytes = new Uint8Array([...s].map((c) => c.charCodeAt(0)))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return s
  }
}

// Strip BOM (﻿ or its mojibake form "ï»¿") from the first cell of the
// first row, which is what papaparse hands us when the file starts with one.
export function stripBom(s) {
  if (!s) return s
  return s.replace(/^﻿/, '').replace(/^ï»¿/, '')
}

// "00:00" → 0, "13:00" → 13. Returns null on anything else.
export function parseHourLabel(label) {
  const m = /^(\d{1,2}):00$/.exec((label || '').trim())
  return m ? Number(m[1]) : null
}

export function toNumber(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
