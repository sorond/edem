import { formatMoney } from '../format.js'
import { shopIsMutable, shopStatusLabel } from '../shop.js'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function safeInt(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function orderItemHtml(line) {
  const quantity = safeInt(line.quantity)
  const unitPrice = safeInt(line.unitPrice)
  const lineTotal = safeInt(line.lineTotal) || quantity * unitPrice
  return `
    <li class="shop-order__item">
      <span>${escapeHtml(line.iconSnapshot)} ${escapeHtml(line.nameSnapshot)}</span>
      <span>${quantity} × ${formatMoney(unitPrice)} = ${formatMoney(lineTotal)}</span>
    </li>
  `
}

function editFormHtml(order, catalog) {
  const id = escapeHtml(order.id)
  const original = new Map(
    (Array.isArray(order.items) ? order.items : [])
      .map((line) => [String(line.itemId), safeInt(line.quantity)]),
  )
  const activeItems = (Array.isArray(catalog) ? catalog : []).filter((item) => item.active)
  const rows = activeItems.map((item) => {
    const itemId = escapeHtml(item.id)
    const current = original.get(String(item.id)) ?? 0
    return `
      <label class="shop-edit__row">
        <span>${escapeHtml(item.icon)} ${escapeHtml(item.name)}</span>
        <input class="input shop-qty" type="number" min="0" max="${safeInt(item.stock)}" step="1"
          data-shop-edit-qty="${itemId}" data-shop-original-qty="${current}" value="${current}">
      </label>
    `
  }).join('')

  return `
    <form class="shop-edit" data-shop-edit-form="${id}" hidden>
      <div class="login__label">РЕДАКТИРОВАНИЕ СОСТАВА</div>
      ${rows || '<p class="task-empty">НЕТ АКТИВНЫХ ТОВАРОВ</p>'}
      <button class="btn" type="submit" data-shop-edit-save="${id}">Сохранить состав</button>
    </form>
  `
}

export function shopAdminOrdersHtml(orders, catalog) {
  const cards = (Array.isArray(orders) ? orders : []).map((order) => {
    const id = escapeHtml(order.id)
    const created = String(order.created_at ?? '').slice(0, 16).replace('T', ' ')
    const lines = (Array.isArray(order.items) ? order.items : []).map(orderItemHtml).join('')
    const mutable = shopIsMutable(order.status)
    const actions = mutable
      ? `<div class="shop-actions">
          <button class="btn" type="button" data-shop-review="${id}" data-shop-decision="approve">Одобрить</button>
          <button class="btn" type="button" data-shop-review="${id}" data-shop-decision="reject">Отклонить</button>
          <button class="btn" type="button" data-shop-edit="${id}">Изменить состав</button>
        </div>`
      : order.status === 'approved'
        ? `<div class="shop-actions"><button class="btn" type="button" data-shop-rollback="${id}">Откатить</button></div>`
        : ''

    return `
      <article class="shop-order">
        <div class="shop-order__head">
          <span>${escapeHtml(shopStatusLabel(order.status))}</span>
          <span>${formatMoney(safeInt(order.total))}</span>
          <span>${escapeHtml(created)}</span>
          <span>КУРАТОР</span>
        </div>
        <ul class="shop-order__items">${lines}</ul>
        ${actions}
        ${mutable ? editFormHtml(order, catalog) : ''}
      </article>
    `
  }).join('')

  return `
    <div class="shop-admin-orders">
      ${cards || '<p class="task-empty">ЗАКАЗОВ НЕТ</p>'}
    </div>
  `
}

function itemFormHtml(item) {
  const isNew = !item
  const id = isNew ? '' : escapeHtml(item.id)
  const name = isNew ? '' : escapeHtml(item.name)
  const icon = isNew ? '' : escapeHtml(item.icon)
  const category = isNew ? '' : escapeHtml(item.category)
  const stock = isNew ? 0 : safeInt(item.stock)
  const price = isNew ? 0 : safeInt(item.price)
  const active = isNew || item.active === true

  return `
    <form class="login__form shop-item-form" data-shop-item-form data-shop-item-id="${id}">
      <label class="login__label">НАЗВАНИЕ</label>
      <input class="input" name="name" type="text" value="${name}" autocomplete="off" required>
      <label class="login__label">ИКОНКА</label>
      <input class="input" name="icon" type="text" maxlength="1" value="${icon}" autocomplete="off" required>
      <label class="login__label">КАТЕГОРИЯ</label>
      <input class="input" name="category" type="text" value="${category}" autocomplete="off" required>
      <label class="login__label">ОСТАТОК</label>
      <input class="input" name="stock" type="number" min="0" step="1" inputmode="numeric" value="${stock}" required>
      <label class="login__label">ЦЕНА</label>
      <input class="input" name="price" type="number" min="0" step="1" inputmode="numeric" value="${price}" required>
      <label class="shop-check"><input type="checkbox" name="active"${active ? ' checked' : ''}> АКТИВЕН</label>
      <button class="btn" type="submit" data-shop-item-save>${isNew ? 'Создать товар' : 'Сохранить товар'}</button>
    </form>
  `
}

export function shopAdminItemsHtml(items) {
  const forms = (Array.isArray(items) ? items : []).map(item => `
    <article class="shop-item">
      <div class="shop-item__head">${escapeHtml(item.icon)} ${escapeHtml(item.name)} · ${escapeHtml(item.category)}</div>
      ${itemFormHtml(item)}
    </article>
  `).join('')

  return `
    <div class="shop-admin-items">
      <h3 class="task-column__title">НОВЫЙ ТОВАР</h3>
      ${itemFormHtml(null)}
      <h3 class="task-column__title">КАТАЛОГ</h3>
      ${forms || '<p class="task-empty">ТОВАРОВ НЕТ</p>'}
    </div>
  `
}
