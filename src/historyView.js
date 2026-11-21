const SHOP_ENTITIES = new Set(['shop_item', 'shop_order'])

export function isShopHistoryRow(row) {
  if (!row) return false
  return SHOP_ENTITIES.has(row.entity) || String(row.action ?? '').startsWith('shop_')
}

export function shopAmountNote(row) {
  const value = row?.details?.total
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return `СУММА: ${number}`
}
