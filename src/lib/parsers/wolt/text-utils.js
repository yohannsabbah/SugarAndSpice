import './domMatrixStub.js' // must run before pdf-parse loads pdf.js
import { PDFParse } from 'pdf-parse'
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs'

// pdf.js normally hands PDF parsing off to a Worker (browser) or, in Node,
// dynamically imports its worker entry via a runtime path on
// GlobalWorkerOptions.workerSrc as a "fake worker". That dynamic import
// can't be traced by Next's server bundler (Turbopack), so it fails at
// request time with "Cannot find module .../pdf.worker.mjs". Statically
// importing the worker module ourselves and exposing it as
// globalThis.pdfjsWorker makes pdf.js use it directly on the main thread
// instead — this is pdf.js's own documented fallback for bundled/
// serverless environments, and it's checked before the dynamic-import path.
if (typeof globalThis.pdfjsWorker === 'undefined') {
  globalThis.pdfjsWorker = { WorkerMessageHandler }
}

export async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer })
  const { text } = await parser.getText()
  return text
}

export function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function num(s) {
  if (s == null) return null
  const cleaned = String(s).replace(/[, ]/g, '').replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function ddmmyyyy(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

export function periodNumberFromFilename(name) {
  const m = name.match(/SEMI_MONTHLY_(\d{4})_(\d{1,2})/i)
  if (!m) return null
  return { year: Number(m[1]), num: Number(m[2]) }
}

export function fields(line) {
  return line.split('\t').map((f) => f.trim()).filter((f) => f !== '')
}

export function findLine(ls, predicate) {
  for (let i = 0; i < ls.length; i++) if (predicate(ls[i], i)) return i
  return -1
}
