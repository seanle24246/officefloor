/* office.lounge.showroom.data.js — the ten-piece office lounge test inventory. */

export const LOUNGE_SHOWROOM_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everything' }),
  Object.freeze({ id: 'bar', label: 'Bar Core' }),
  Object.freeze({ id: 'furniture', label: 'Furniture' }),
  Object.freeze({ id: 'entertainment', label: 'Entertainment' }),
]);

export const LOUNGE_SHOWROOM_ITEMS = Object.freeze([
  Object.freeze({ id: 'bar-counter', label: 'Bar Counter', category: 'bar', family: 'lounge', kind: 'bar-counter' }),
  Object.freeze({ id: 'back-bar', label: 'Back-Bar Display', category: 'bar', family: 'lounge', kind: 'back-bar' }),
  Object.freeze({ id: 'beer-keg', label: 'Beer Keg', category: 'bar', family: 'lounge', kind: 'beer-keg' }),
  Object.freeze({ id: 'draft-tower', label: 'Draft Tap Tower', category: 'bar', family: 'lounge', kind: 'draft-tower' }),
  Object.freeze({ id: 'bar-stool', label: 'Bar Stool', category: 'furniture', family: 'lounge', kind: 'bar-stool' }),
  Object.freeze({ id: 'drinks-fridge', label: 'Drinks Fridge', category: 'bar', family: 'amenities', sku: 'sku-0503' }),
  Object.freeze({ id: 'dartboard', label: 'Dartboard', category: 'entertainment', family: 'games', sku: 'sku-0602' }),
  Object.freeze({ id: 'pool-table', label: 'Pool Table', category: 'entertainment', family: 'games', sku: 'sku-0601' }),
  Object.freeze({ id: 'television', label: 'Television', category: 'entertainment', family: 'lounge', kind: 'television' }),
  Object.freeze({ id: 'jukebox', label: 'Jukebox', category: 'entertainment', family: 'games', sku: 'sku-0613' }),
]);

export function loungeItemsForCategory(category) {
  return category === 'all'
    ? [...LOUNGE_SHOWROOM_ITEMS]
    : LOUNGE_SHOWROOM_ITEMS.filter((item) => item.category === category);
}
