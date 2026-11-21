import { describe, it, expect } from 'vitest'
import { shopAdminItemsHtml, shopAdminOrdersHtml } from '../src/admin/shopViews.js'

describe('admin shop views', () => {
  it('marks approved orders as non-mutable', () => {
    const html = shopAdminOrdersHtml([{
      id: 'o1', status: 'approved', total: 100, created_at: '2026-11-21T10:00:00Z',
      items: [{ nameSnapshot: 'БИНТЫ', quantity: 1, unitPrice: 100, lineTotal: 100, iconSnapshot: '▣' }],
    }], [])
    expect(html).toContain('[OK] ОДОБРЕН')
    expect(html).toContain('data-shop-rollback="o1"')
    expect(html).not.toContain('data-shop-review="o1"')
  })

  it('renders item prices in the catalogue editor', () => {
    const html = shopAdminItemsHtml([{ id: 'i1', name: 'АПТЕЧКА', icon: '✚', category: 'РАСХОДНИКИ', stock: 12, price: 250, active: true }])
    expect(html).toContain('250')
    expect(html).toContain('data-shop-item-id="i1"')
  })

  it('shows edit controls and escaped snapshots for new orders', () => {
    const html = shopAdminOrdersHtml([{
      id: 'o2', status: 'new', total: 50, created_at: '<b>',
      items: [{ nameSnapshot: '<img>', quantity: 1, unitPrice: 50, lineTotal: 50, iconSnapshot: '&' }],
    }], [{ id: 'i1', name: 'АПТЕЧКА', icon: '✚', category: 'РАСХОДНИКИ', stock: 5, price: 50, active: true }])
    expect(html).toContain('data-shop-review="o2"')
    expect(html).toContain('data-shop-edit="o2"')
    expect(html).not.toContain('<img>')
    expect(html).not.toContain('<b>')
  })
})
