// Israeli VAT, used to show the admin overview without VAT.
// Income and Wolt fees carry VAT. As a licensed dealer (osek murshe) the
// business pays the VAT on sales to the tax authority and reclaims the VAT
// on most expenses, so the real numbers are the ones without VAT.

export const VAT_RATE = 0.18

// Share of an expense amount that is reclaimable VAT, by expense category.
// The amounts are full card charges (VAT included). Categories with no
// reclaimable VAT get 0: bank fees, insurance, arnona/taxes, salary, and
// meals (input VAT on meals and refreshments is not deductible).
// Check these against the accountant's rules.
export const EXPENSE_VAT_RATE = {
  cogs_food:     VAT_RATE,
  cogs_supplies: VAT_RATE,
  equipment:     VAT_RATE,
  rent:          0,          // this landlord is private: no VAT on the rent
  salary:        0,
  utilities:     VAT_RATE,
  marketing:     VAT_RATE,
  transport:     VAT_RATE,
  fees:          0,
  professional:  VAT_RATE,
  taxes:         0,
  insurance:     0,
  meals:         0,
  personal:      0,
  other:         VAT_RATE,
}

export function withoutVat(amountInclVat, rate = VAT_RATE) {
  return amountInclVat / (1 + rate)
}
