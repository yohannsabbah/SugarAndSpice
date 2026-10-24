// What a receipt paid for. Claude picks one when it reads the photo; the owner
// can change it. Pure, so the client table and the verify scripts can use it.

export const RECEIPT_CATEGORIES = ['ingredients', 'packaging', 'cleaning', 'equipment', 'office', 'transport', 'meals', 'other']

export const RECEIPT_CATEGORY_LABEL = {
  ingredients: 'Ingredients',
  packaging: 'Packaging',
  cleaning: 'Cleaning',
  equipment: 'Equipment',
  office: 'Office',
  transport: 'Transport',
  meals: 'Meals',
  other: 'Other',
}

// Read by the model. Short, so the choice stays easy.
export const CATEGORY_HINTS =
  'ingredients (food and baking supplies to sell), packaging (boxes, bags, cups, labels), ' +
  'cleaning (cleaning and hygiene supplies), equipment (tools, appliances, repairs), ' +
  'office (stationery, printing, phone), transport (fuel, taxi, parking, delivery), ' +
  'meals (food for the staff), other'

export function categoryLabel(c) {
  return c ? RECEIPT_CATEGORY_LABEL[c] || c : 'Uncategorized'
}
