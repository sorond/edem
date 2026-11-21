import { describe, it, expect } from 'vitest'
import { shopCatalogHtml, shopOrdersHtml } from '../src/shop/views.js'

describe('shop views', () => {
  it('renders zero-stock items as disabled', () => {
    const html = shopCatalogHtml(
      [{ id: 'i1', name: 'ЩИТ', icon: '△', category: 'ЗАЩИТА', stock: 0, price: 500, active: true }],
      new Map(),
    )
    expect(html).toContain('[НЕТ]')
    expect(html).not.toContain('data-shop-qty="i1"')
  })

  it('renders order statuses with prefixes and mutable cancel button', () => {
    const html = shopOrdersHtml([{
      id: 'o1', status: 'new', total: 750, created_at: '2026-11-21T10:00:00Z',
      items: [{ nameSnapshot: 'АПТЕЧКА', quantity: 2, unitPrice: 375, lineTotal: 750, iconSnapshot: '✚' }],
    }])
    expect(html).toContain('[!] НОВЫЙ')
    expect(html).toContain('750')
    expect(html).toContain('data-shop-cancel="o1"')
  })

  it('escapes server strings and hides cancel on finished orders', () => {
    const html = shopOrdersHtml([{
      id: 'o2', status: 'approved', total: 100, created_at: '<script>',
      items: [{ nameSnapshot: '<img>', quantity: 1, unitPrice: 100, lineTotal: 100, iconSnapshot: '&' }],
    }])
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img>')
    expect(html).not.toContain('data-shop-cancel="o2"')
  })
})
