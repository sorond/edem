import { formatMoney } from '../format.js'
import {
  shopCoerceQuantity,
  shopIsMutable,
  shopLineTotal,
  shopOrderTotal,
  shopStatusLabel,
} from '../shop.js'

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

export function shopCartInnerHtml(items, cart) {
  const lines = (Array.isArray(items) ? items : []).map((item) => ({
    quantity: shopCoerceQuantity(cart?.get(item.id), item.stock),
    unitPrice: safeInt(item.price),
  }))
  const positions = lines.filter((line) => line.quantity > 0).length
  const total = shopOrderTotal(lines)

  return `
    <div class="shop-cart__line">ПОЗИЦИЙ: ${positions}</div>
    <div class="shop-cart__line">СУММА: ${formatMoney(total)}</div>
    <button class="btn" type="button" data-shop-submit${positions ? '' : ' disabled'}>Оформить заказ</button>
  `
}

export function shopCartHtml(items, cart) {
  return `<div class="shop-cart" data-shop-cart>${shopCartInnerHtml(items, cart)}</div>`
}

export function shopCatalogHtml(items, cart) {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const id = escapeHtml(item.id)
    const stock = safeInt(item.stock)
    const quantity = shopCoerceQuantity(cart?.get(item.id), stock)
    const quantityCell = stock > 0
      ? `<input class="input shop-qty" type="number" min="0" max="${stock}" step="1" inputmode="numeric" data-shop-qty="${id}" value="${quantity}" aria-label="Количество: ${escapeHtml(item.name)}">`
      : '<span class="shop-out">[НЕТ]</span>'

    return `
      <tr data-shop-item="${id}">
        <td>${escapeHtml(item.icon)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${formatMoney(safeInt(item.price))}</td>
        <td>${stock > 0 ? stock : '[НЕТ]'}</td>
        <td>${quantityCell}</td>
      </tr>
    `
  }).join('')

  return `
    <section class="shop-catalog">
      <h2 class="task-column__title">КАТАЛОГ</h2>
      <div class="shop-table-wrap">
        <table class="shop-table">
          <thead>
            <tr><th>ИКОНКА</th><th>НАЗВАНИЕ</th><th>КАТЕГОРИЯ</th><th>ЦЕНА</th><th>ОСТАТОК</th><th>КОЛ-ВО</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="task-empty">ТОВАРОВ НЕТ</td></tr>'}</tbody>
        </table>
      </div>
      ${shopCartHtml(items, cart)}
    </section>
  `
}

function orderItemHtml(line) {
  const quantity = safeInt(line.quantity)
  const unitPrice = safeInt(line.unitPrice)
  const lineTotal = safeInt(line.lineTotal) || shopLineTotal(quantity, unitPrice)
  return `
    <li class="shop-order__item">
      <span>${escapeHtml(line.iconSnapshot)} ${escapeHtml(line.nameSnapshot)}</span>
      <span>${quantity} × ${formatMoney(unitPrice)} = ${formatMoney(lineTotal)}</span>
    </li>
  `
}

export function shopOrdersHtml(orders) {
  const cards = (Array.isArray(orders) ? orders : []).map((order) => {
    const id = escapeHtml(order.id)
    const created = String(order.created_at ?? '').slice(0, 16).replace('T', ' ')
    const cancel = shopIsMutable(order.status)
      ? `<button class="btn" type="button" data-shop-cancel="${id}">Отменить</button>`
      : ''
    const lines = (Array.isArray(order.items) ? order.items : []).map(orderItemHtml).join('')

    return `
      <article class="shop-order">
        <div class="shop-order__head">
          <span>${escapeHtml(shopStatusLabel(order.status))}</span>
          <span>${formatMoney(safeInt(order.total))}</span>
          <span>${escapeHtml(created)}</span>
          <span>КУРАТОР</span>
        </div>
        <ul class="shop-order__items">${lines}</ul>
        ${cancel}
      </article>
    `
  }).join('')

  return `
    <section class="shop-orders" data-shop-orders>
      <h2 class="task-column__title">МОИ ЗАКАЗЫ</h2>
      ${cards || '<p class="task-empty">ЗАКАЗОВ НЕТ</p>'}
    </section>
  `
}
