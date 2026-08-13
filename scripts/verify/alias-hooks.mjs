import { pathToFileURL } from 'node:url'
import path from 'node:path'

const srcRoot = path.resolve(import.meta.dirname, '../../src')

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return nextResolve(pathToFileURL(path.join(import.meta.dirname, 'server-only-shim.mjs')).href, context)
  }
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2)
    const withExt = path.extname(rel) ? rel : `${rel}.js`
    const target = pathToFileURL(path.join(srcRoot, withExt)).href
    return nextResolve(target, context)
  }
  return nextResolve(specifier, context)
}
