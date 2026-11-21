import { shopApi } from '../shopApi.js'
import { shopAdminItemsHtml, shopAdminOrdersHtml } from './shopViews.js'

const state = {
  ordersRoot: null,
  itemsRoot: null,
  catalog: [],
  orders: [],
  ordersMessage: '',
  itemsMessage: '',
  busy: false,
}

function appendMessage(root, message) {
  if (!root || !message) return
  const node = document.createElement('div')
  node.className = 'shop-msg'
  node.textContent = message
  if (message.startsWith('[ERR]')) node.classList.add('shop-msg--error')
  root.appendChild(node)
}

function renderOrders() {
  if (!state.ordersRoot) return
  state.ordersRoot.innerHTML = shopAdminOrdersHtml(state.orders, state.catalog)
  appendMessage(state.ordersRoot, state.ordersMessage)
}

function renderItems() {
  if (!state.itemsRoot) return
  state.itemsRoot.innerHTML = shopAdminItemsHtml(state.catalog)
  appendMessage(state.itemsRoot, state.itemsMessage)
}

async function refresh() {
  try {
    const [catalog, orders] = await Promise.all([
      shopApi.getCatalog(),
      shopApi.getOrders(),
    ])
    state.catalog = Array.isArray(catalog) ? catalog : []
    state.orders = Array.isArray(orders) ? orders : []
    renderOrders()
    renderItems()
  } catch (error) {
    state.ordersMessage = '[ERR] НЕ УДАЛОСЬ ЗАГРУЗИТЬ ЗАКАЗЫ'
    state.itemsMessage = '[ERR] НЕ УДАЛОСЬ ЗАГРУЗИТЬ КАТАЛОГ'
    renderOrders()
    renderItems()
    console.error('shop admin load:', error)
  }
}

async function run(action, target, successMessage) {
  if (state.busy) return
  state.busy = true
  const key = target === 'orders' ? 'ordersMessage' : 'itemsMessage'
  state[key] = ''
  try {
    await action()
    state[key] = successMessage
    await refresh()
  } catch (error) {
    state[key] = '[ERR] ОПЕРАЦИЯ НЕ ВЫПОЛНЕНА'
    if (target === 'orders') renderOrders()
    else renderItems()
    console.error('shop admin action:', error)
  } finally {
    state.busy = false
  }
}

function formField(form, name) {
  return form.elements.namedItem(name)
}

function itemPayload(form) {
  return {
    name: String(formField(form, 'name')?.value ?? '').trim(),
    icon: String(formField(form, 'icon')?.value ?? '').trim(),
    category: String(formField(form, 'category')?.value ?? '').trim(),
    stock: Number(formField(form, 'stock')?.value),
    price: Number(formField(form, 'price')?.value),
  }
}

function bindOrders(root) {
  root.addEventListener('click', async (event) => {
    const review = event.target.closest?.('[data-shop-review]')
    if (review) {
      const approve = review.dataset.shopDecision === 'approve'
      await run(
        () => shopApi.reviewOrder(review.dataset.shopReview, approve),
        'orders',
        approve ? '[OK] ЗАКАЗ ОДОБРЕН' : '[OK] ЗАКАЗ ОТВЕРГНУТ',
      )
      return
    }

    const rollback = event.target.closest?.('[data-shop-rollback]')
    if (rollback) {
      await run(
        () => shopApi.rollbackOrder(rollback.dataset.shopRollback),
        'orders',
        '[OK] ЗАКАЗ ОТКАТАН',
      )
      return
    }

    const edit = event.target.closest?.('[data-shop-edit]')
    if (edit) {
      const id = edit.dataset.shopEdit
      const form = [...root.querySelectorAll('[data-shop-edit-form]')]
        .find((candidate) => candidate.dataset.shopEditForm === id)
      if (form) form.hidden = !form.hidden
    }
  })

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('[data-shop-edit-form]')
    if (!form) return
    event.preventDefault()
    const lines = [...form.querySelectorAll('[data-shop-edit-qty]')]
      .map((input) => ({
        itemId: input.dataset.shopEditQty,
        quantity: Number(input.value),
      }))
      .filter((line) => Number.isSafeInteger(line.quantity) && line.quantity > 0)

    await run(
      () => shopApi.editOrder(form.dataset.shopEditForm, lines),
      'orders',
      '[OK] СОСТАВ ИЗМЕНЁН',
    )
  })
}

function bindItems(root) {
  root.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('[data-shop-item-form]')
    if (!form) return
    event.preventDefault()
    const payload = itemPayload(form)
    const id = form.dataset.shopItemId
    await run(
      () => (id ? shopApi.updateItem(id, payload) : shopApi.createItem(payload)),
      'items',
      id ? '[OK] ТОВАР ОБНОВЛЁН' : '[OK] ТОВАР СОЗДАН',
    )
  })

  root.addEventListener('change', async (event) => {
    const checkbox = event.target.closest?.('input[name="active"]')
    if (!checkbox) return
    const form = checkbox.closest('[data-shop-item-form]')
    const id = form?.dataset.shopItemId
    if (!id) return
    await run(
      () => shopApi.setItemActive(id, checkbox.checked),
      'items',
      '[OK] СТАТУС ТОВАРА ИЗМЕНЁН',
    )
  })
}

export async function mountShopAdmin(ordersRoot, itemsRoot) {
  if (!ordersRoot || !itemsRoot) return

  if (state.ordersRoot !== ordersRoot || state.itemsRoot !== itemsRoot) {
    state.ordersRoot = ordersRoot
    state.itemsRoot = itemsRoot
    state.catalog = []
    state.orders = []
    state.ordersMessage = ''
    state.itemsMessage = ''
  }

  if (ordersRoot.dataset.shopAdminBound !== '1') {
    ordersRoot.dataset.shopAdminBound = '1'
    bindOrders(ordersRoot)
  }
  if (itemsRoot.dataset.shopAdminBound !== '1') {
    itemsRoot.dataset.shopAdminBound = '1'
    bindItems(itemsRoot)
  }

  await refresh()
}
