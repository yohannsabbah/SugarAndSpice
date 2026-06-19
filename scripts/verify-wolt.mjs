// Quick sanity-check: read back the backfilled Wolt data and reconcile against
// the values we hand-derived from the PDFs earlier.
//
// Run: node --env-file=.env.local scripts/verify-wolt.mjs

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const { data: periods } = await supabase
  .from('wolt_periods')
  .select('period_num, period_start, period_end, gross_sales_incl_vat, wolt_fees_incl_vat, withholding_amount, installments_amount, net_payout')
  .order('period_num')

console.log('\nPeriods:')
console.table(periods)

const aprMay = {
  apr_gross: periods.filter(p => p.period_num <= 8).reduce((s,p) => s + Number(p.gross_sales_incl_vat || 0), 0),
  may_gross: periods.filter(p => p.period_num >= 9).reduce((s,p) => s + Number(p.gross_sales_incl_vat || 0), 0),
  apr_payout: periods.filter(p => p.period_num <= 8).reduce((s,p) => s + Number(p.net_payout || 0), 0),
  may_payout: periods.filter(p => p.period_num >= 9).reduce((s,p) => s + Number(p.net_payout || 0), 0),
}
console.log(`\nMonth totals (expect Apr gross 10,731 / payout 4,800.20 ; May gross 14,679 / payout 6,652.90):`)
console.table(aprMay)

// Ad spend per period
const { data: ads } = await supabase
  .from('wolt_period_fees')
  .select('period_id, fee_category, amount_incl_vat')
  .eq('fee_category', 'ad_campaign')
console.log(`\nAd spend rows (expect 3+3+3+3 = ~12 rows): ${ads.length}`)
const totalAds = ads.reduce((s, a) => s + Number(a.amount_incl_vat), 0)
console.log(`Total ad spend Apr+May: ${totalAds.toFixed(2)} (expect ~3043)`)

// Top items April + May from wolt_period_items
const { data: topMay } = await supabase
  .from('wolt_period_items')
  .select('item_name, units_sold, revenue_incl_vat')
  .eq('month_start', '2026-05-01')
  .order('units_sold', { ascending: false })
  .limit(5)
console.log('\nTop 5 May items (expect SAN SEBASTIAN x59 ; Brownies x46 ; Truffle x43):')
console.table(topMay)

// Channel mix
const { data: ch } = await supabase
  .from('wolt_orders')
  .select('channel, status')
const byChannel = ch.reduce((m, o) => { m[o.channel] = (m[o.channel] || 0) + 1; return m }, {})
const byStatus = ch.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m }, {})
console.log(`\nOrders total: ${ch.length}  by channel: ${JSON.stringify(byChannel)}  by status: ${JSON.stringify(byStatus)}`)

// Item-name → category sanity check
const { data: cats } = await supabase
  .from('items')
  .select('category')
const catCount = cats.reduce((m, i) => { m[i.category || 'null'] = (m[i.category || 'null'] || 0) + 1; return m }, {})
console.log(`\nItems by category: ${JSON.stringify(catCount)}`)

// Average order value, delivered only
const delivered = ch.filter(o => o.status === 'delivered')
const { data: deliveredOrders } = await supabase
  .from('wolt_orders').select('price_incl_vat, channel, status')
  .eq('status', 'delivered')
const aov = deliveredOrders.reduce((s, o) => s + Number(o.price_incl_vat || 0), 0) / deliveredOrders.length
console.log(`\nDelivered AOV: ${aov.toFixed(2)} (expect ~74)`)
