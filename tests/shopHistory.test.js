import { describe, it, expect } from 'vitest'
import { isShopHistoryRow, shopAmountNote } from '../src/historyView.js'

describe('shop history', () => {
  it('matches shop actions even when entity is treasury', () => {
    expect(isShopHistoryRow({ entity: 'treasury', action: 'shop_reserve_order' })).toBe(true)
    expect(isShopHistoryRow({ entity: 'shop_item', action: 'update_settings' })).toBe(true)
    expect(isShopHistoryRow({ entity: 'task', action: 'create_task' })).toBe(false)
  })

  it('renders amount from audit details', () => {
    expect(shopAmountNote({ details: { total: 750 } })).toBe('СУММА: 750')
    expect(shopAmountNote({ details: { total: '1250' } })).toBe('СУММА: 1250')
    expect(shopAmountNote({ details: {} })).toBeNull()
    expect(shopAmountNote({ details: { total: 'x' } })).toBeNull()
  })
})
