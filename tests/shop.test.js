import { describe, it, expect } from 'vitest'
import {
  shopCoerceQuantity,
  shopIsMutable,
  shopLineTotal,
  shopNeedsRefund,
  shopOrderTotal,
  shopStatusLabel,
  shopStockSufficient,
} from '../src/shop.js'

describe('shop money and quantity helpers', () => {
  it('calculates line and order totals', () => {
    expect(shopLineTotal(3, 250)).toBe(750)
    expect(shopOrderTotal([{ quantity: 2, unitPrice: 100 }, { quantity: 1, unitPrice: 55 }])).toBe(255)
  })

  it('clamps quantity to the available stock', () => {
    expect(shopCoerceQuantity('4', 3)).toBe(3)
    expect(shopCoerceQuantity(-2, 5)).toBe(0)
    expect(shopCoerceQuantity('abc', 5)).toBe(0)
  })

  it('checks stock by item id', () => {
    const lines = [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }]
    expect(shopStockSufficient(lines, { a: 2, b: 4 })).toBe(true)
    expect(shopStockSufficient(lines, { a: 1, b: 4 })).toBe(false)
  })
})

describe('shop status helpers', () => {
  it('renders monochrome status labels', () => {
    expect(shopStatusLabel('new')).toBe('[!] НОВЫЙ')
    expect(shopStatusLabel('approved')).toBe('[OK] ОДОБРЕН')
    expect(shopStatusLabel('rejected')).toBe('[ERR] ОТВЕРГНУТ')
    expect(shopStatusLabel('cancelled')).toBe('[X] ОТМЕНЁН')
    expect(shopStatusLabel('rolled_back')).toBe('[↩] ОТКАТАН')
  })

  it('allows edits and refunds only in the right states', () => {
    expect(shopIsMutable('new')).toBe(true)
    expect(shopIsMutable('approved')).toBe(false)
    expect(shopNeedsRefund('cancelled')).toBe(true)
    expect(shopNeedsRefund('rejected')).toBe(true)
    expect(shopNeedsRefund('rolled_back')).toBe(true)
    expect(shopNeedsRefund('new')).toBe(false)
  })
})
