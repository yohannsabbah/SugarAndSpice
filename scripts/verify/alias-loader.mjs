// Lets plain `node` scripts import files that use the Next.js "@/..." path
// alias (e.g. src/lib/db/wolt.js imports '@/lib/supabase'). Next's bundler
// resolves this via jsconfig.json; plain Node doesn't know about it, so we
// register a resolve hook (alias-hooks.mjs) that rewrites "@/x" to
// "<repo>/src/x" before Node's normal resolution runs.
//
// Usage: node --import ./scripts/verify/alias-loader.mjs <script.mjs>
import { register } from 'node:module'

register('./alias-hooks.mjs', import.meta.url)
