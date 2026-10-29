// Display labels for item categories (items.category). The rules that assign
// them live in inferCategory() in src/lib/db/wolt.js.
export const ITEM_CATEGORY_LABEL = {
  bowl: 'Bowls',
  food: 'Food',
  coffee_hot: 'Hot coffee',
  coffee_cold: 'Cold coffee',
  matcha: 'Matcha',
  mochi: 'Mochi',
  tea: 'Tea',
  soda: 'Soda / juice',
  cake: 'Cakes & pastry',
  kids: 'Kids',
  merch: 'Merch',
  other: 'Other',
}

export function prettyCategory(c) {
  return ITEM_CATEGORY_LABEL[c] || c
}
