import { describe, it, expect, vi } from 'vitest'
import { makeShopApi } from '../src/shopApi.js'

describe('makeShopApi', () => {
  it('passes exact RPC names and parameters', async () => {
    const calls = []
    const invoke = vi.fn(async (name, params) => { calls.push([name, params]); return { ok: true } })
    const api = makeShopApi(invoke)
    const item = { name: 'ЩИТ', icon: '△', category: 'ЗАЩИТА', stock: 5, price: 100 }
    const items = [{ itemId: 'i1', quantity: 2 }]

    await api.getCatalog()
    await api.getOrders()
    await api.createItem(item)
    await api.updateItem('i1', item)
    await api.setItemActive('i1', false)
    await api.createOrder(items)
    await api.cancelOrder('o1')
    await api.editOrder('o1', items)
    await api.reviewOrder('o1', true)
    await api.rollbackOrder('o1')

    expect(calls).toEqual([
      ['shop_get_catalog', undefined],
      ['shop_get_orders', undefined],
      ['shop_create_item', { p_name: 'ЩИТ', p_icon: '△', p_category: 'ЗАЩИТА', p_stock: 5, p_price: 100 }],
      ['shop_update_item', { p_id: 'i1', p_name: 'ЩИТ', p_icon: '△', p_category: 'ЗАЩИТА', p_stock: 5, p_price: 100 }],
      ['shop_set_item_active', { p_id: 'i1', p_active: false }],
      ['shop_create_order', { p_items: items }],
      ['shop_cancel_order', { p_order_id: 'o1' }],
      ['shop_edit_order', { p_order_id: 'o1', p_items: items }],
      ['shop_review_order', { p_order_id: 'o1', p_approve: true }],
      ['shop_rollback_order', { p_order_id: 'o1' }],
    ])
  })
})
