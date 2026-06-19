import { pdfText, lines, num, ddmmyyyy, fields, findLine } from './text-utils.js'

// Hebrew label fragments we anchor on (appear in pdf-parse output AFTER the values
// on each line because the source is RTL).
const LABELS = {
  invoiceDate: "חשבונית תאריך",      // "תאריך חשבונית"
  invoiceNo:   "חשבונית 'מס",        // "מס' חשבונית"
  period:      "החיוב תקופת",        // "תקופת החיוב"
  total:       "חשבונית סכום",       // "סכום חשבונית"
  pickup10:    "10% לקחת ,עמלה",     // "עמלה, לקחת 10%"
  delPlus:     "Wolt+ 25% משלוח ,שירות דמי", // "דמי שירות, משלוח Wolt+ 25%"
  delivery:    "25% משלוח ,שירות דמי",       // "דמי שירות, משלוח 25%"
  addons:      "25% משלוח ,תוספות על עמלה", // "עמלה על תוספות, משלוח 25%"
  perOrderPlus:"Wolt+ 3.80 של קבועה עמלה",  // "עמלה קבועה של 3.80 Wolt+"
  missingItem: "שליח ידי על מחדש שליחה - שגוי פריט", // "פריט שגוי - שליחה מחדש על ידי שליח"
}

function parseRow5(line) {
  // <label>\t<base>\t<excl_vat>\t<vat%>\t<vat>\t<incl_vat>
  const f = fields(line)
  if (f.length < 6) return null
  return {
    label: f[0],
    base: num(f[1]),
    amount_excl_vat: num(f[2]),
    vat_amount: num(f[4]),
    amount_incl_vat: num(f[5]),
  }
}

function parsePerOrderRow(line) {
  // <label>\t<units>\t<excl_vat>\t<vat%>\t<vat>\t<incl_vat>
  const f = fields(line)
  if (f.length < 6) return null
  return {
    label: f[0],
    units: Math.round(num(f[1])),
    amount_excl_vat: num(f[2]),
    vat_amount: num(f[4]),
    amount_incl_vat: num(f[5]),
  }
}

function parseFeeRow4(line) {
  // The "עמלות נוספות ללא מע״מ" section: <label>\t<excl>\t<vat%>\t<vat>\t<incl>
  const f = fields(line)
  if (f.length < 5) return null
  return {
    label: f[0],
    amount_excl_vat: num(f[1]),
    vat_amount: num(f[3]),
    amount_incl_vat: num(f[4]),
  }
}

function parseAdRow(descriptionLines, valueLine) {
  // Ad / VAT-adjustment rows have multi-line description before a value row:
  //   <units>\t<excl_vat>\t<vat%>\t<vat>\t<incl_vat>
  const f = fields(valueLine)
  if (f.length < 5) return null
  return {
    description: descriptionLines.join(' ').replace(/\s+/g, ' ').trim(),
    units: Math.round(num(f[0])) || 1,
    amount_excl_vat: num(f[1]),
    vat_amount: num(f[3]),
    amount_incl_vat: num(f[4]),
  }
}

function adCategory(description) {
  if (/^Ad campaign/i.test(description)) return 'ad_campaign'
  if (/Weekly \d+:.+update VAT/i.test(description)) return 'vat_adjustment'
  return 'other'
}

function adFields(description) {
  // Pull campaign id + date range from descriptions like:
  // "Ad campaign - Attributed purchases between 2026-05-10 - 2026-05-14 Campaign ID: <uuid>"
  // or "Ad campaign - Attributed purchases on 2026-04-09 Campaign ID: <uuid>"
  const idMatch = description.match(/Campaign ID:\s*([0-9a-f-]{8,})/i)
  const rangeMatch = description.match(/between\s+(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/i)
  const singleMatch = description.match(/on\s+(\d{4}-\d{2}-\d{2})/i)
  return {
    campaign_id: idMatch?.[1] || null,
    campaign_start: rangeMatch?.[1] || singleMatch?.[1] || null,
    campaign_end: rangeMatch?.[2] || singleMatch?.[1] || null,
  }
}

export async function parseWoltToMerchant(buffer) {
  const text = await pdfText(buffer)
  const ls = lines(text)

  // -- Header fields ----------------------------------------------------------
  let invoiceDate = null, invoiceNo = null, periodStart = null, periodEnd = null

  for (const l of ls) {
    if (!invoiceDate && l.includes(LABELS.invoiceDate)) {
      invoiceDate = ddmmyyyy(l.split('\t')[0].trim())
    }
    if (!invoiceNo && l.includes(LABELS.invoiceNo)) {
      const m = l.match(/^(\d+)\s/)
      if (m) invoiceNo = m[1]
    }
    if (!periodStart && l.includes(LABELS.period)) {
      const m = l.match(/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/)
      if (m) { periodEnd = ddmmyyyy(m[1]); periodStart = ddmmyyyy(m[2]) }
      // Note: in this Hebrew layout, the LATER date is shown first ("end - start").
    }
  }

  // -- Fee lines --------------------------------------------------------------
  const fees = []

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]

    // Commission rows (5-col)
    if (l.includes(LABELS.pickup10)) {
      const r = parseRow5(l); if (r) fees.push({ ...r, fee_category: 'commission_pickup', description: r.label })
    } else if (l.includes(LABELS.delPlus)) {
      const r = parseRow5(l); if (r) fees.push({ ...r, fee_category: 'commission_delivery_woltplus', description: r.label })
    } else if (l.includes(LABELS.addons)) {
      const r = parseRow5(l); if (r) fees.push({ ...r, fee_category: 'commission_addons', description: r.label })
    } else if (l.includes(LABELS.delivery)) {
      // Must come AFTER delPlus check because both contain "25% משלוח ,שירות דמי"
      // The Wolt+ variant has the extra "Wolt+" prefix.
      const r = parseRow5(l); if (r) fees.push({ ...r, fee_category: 'commission_delivery', description: r.label })

    // Per-order Wolt+ fee
    } else if (l.includes(LABELS.perOrderPlus)) {
      const r = parsePerOrderRow(l)
      if (r) fees.push({
        fee_category: 'per_order_woltplus',
        description: r.label,
        units: r.units,
        base_amount: null,
        amount_excl_vat: r.amount_excl_vat,
        vat_amount: r.vat_amount,
        amount_incl_vat: r.amount_incl_vat,
      })

    // Missing item / additional fees (4-col, no base)
    } else if (l.includes(LABELS.missingItem)) {
      const r = parseFeeRow4(l)
      if (r) fees.push({
        fee_category: 'missing_item',
        description: r.label,
        amount_excl_vat: r.amount_excl_vat,
        vat_amount: r.vat_amount,
        amount_incl_vat: r.amount_incl_vat,
      })

    // Ad campaign / VAT adjustment — multi-line description, value row at the end.
    // A value row matches /^\d+\t/ (units, then tab, then prices). The description
    // can span multiple lines, some of which may start with digits (like
    // "2026-05-10 - 2026-05-14 Campaign ID:"), so we can NOT terminate on /^\d/.
    } else if (/^Ad campaign/i.test(l) || /^Weekly \d+:/i.test(l)) {
      const desc = [l]
      let j = i + 1
      while (j < ls.length && !/^\d+\t/.test(ls[j])) {
        desc.push(ls[j])
        j++
      }
      if (j < ls.length) {
        const r = parseAdRow(desc, ls[j])
        if (r) {
          const cat = adCategory(r.description)
          fees.push({
            fee_category: cat,
            description: r.description,
            units: r.units,
            amount_excl_vat: r.amount_excl_vat,
            vat_amount: r.vat_amount,
            amount_incl_vat: r.amount_incl_vat,
            ...(cat === 'ad_campaign' ? adFields(r.description) : {}),
          })
          i = j
        }
      }
    }
  }

  // -- Invoice total ----------------------------------------------------------
  let totalExclVat = null, totalVat = null, totalInclVat = null
  for (const l of ls) {
    if (l.includes(LABELS.total)) {
      const f = fields(l)
      if (f.length >= 5) {
        totalExclVat = num(f[1])
        totalVat = num(f[3])
        totalInclVat = num(f[4])
      }
      break
    }
  }

  return {
    docType: 'wolt_invoice_w2m',
    invoiceNo,
    invoiceDate,
    periodStart,
    periodEnd,
    fees,
    totalExclVat,
    totalVat,
    totalInclVat,
  }
}
