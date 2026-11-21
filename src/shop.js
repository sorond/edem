const STATUS_LABEL = {
  new: '[!] НОВЫЙ',
  approved: '[OK] ОДОБРЕН',
  rejected: '[ERR] ОТВЕРГНУТ',
  cancelled: '[X] ОТМЕНЁН',
  rolled_back: '[↩] ОТКАТАН',
}

const REFUND_STATUS = new Set(['cancelled', 'rejected', 'rolled_back'])

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0
}

export function shopLineTotal(quantity, unitPrice) {
  return safeInteger(quantity) * safeInteger(unitPrice)
}

export function shopOrderTotal(lines) {
  if (!Array.isArray(lines)) return 0
  return lines.reduce((sum, line) => sum + shopLineTotal(line?.quantity, line?.unitPrice), 0)
}

export function shopCoerceQuantity(raw, max) {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(value)) return 0
  const limit = Number.isSafeInteger(max) && max >= 0 ? max : 0
  return Math.min(Math.max(value, 0), limit)
}

export function shopStockSufficient(lines, stockById) {
  if (!Array.isArray(lines) || !stockById) return false
  return lines.every((line) => {
    const quantity = line?.quantity
    const stock = stockById[line?.itemId]
    return Number.isSafeInteger(quantity) && quantity >= 0
      && Number.isSafeInteger(stock) && quantity <= stock
  })
}

export function shopStatusLabel(status) {
  return STATUS_LABEL[status] ?? '[!] НЕИЗВЕСТНО'
}

export function shopIsMutable(status) {
  return status === 'new'
}

export function shopNeedsRefund(status) {
  return REFUND_STATUS.has(status)
}
