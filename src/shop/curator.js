import { shopApi } from '../shopApi.js'
import { shopCoerceQuantity } from '../shop.js'
import {
  shopCartInnerHtml,
  shopCatalogHtml,
  shopOrdersHtml,
} from './views.js'

const state = {
  panel: null,
  cart: new Map(),
  catalog: [],
  orders: [],
  cartMessage: '',
  orderMessage: '',
  busy: false,
}

function appendMessage(host, text, isError) {
  if (!host || !text) return
  const node = document.createElement('div')
  node.className = isError ? 'shop-msg shop-msg--error' : 'shop-msg'
  node.textContent = text
  host.appendChild(node)
}

function paintMessages() {
  if (!state.panel) return
  appendMessage(state.panel.querySelector('[data-shop-cart]'), state.cartMessage, state.cartMessage.startsWith('[ERR]'))
  appendMessage(state.panel.querySelector('[data-shop-orders]'), state.orderMessage, state.orderMessage.startsWith('[ERR]'))
}

function render() {
  if (!state.panel) return
  state.panel.innerHTML = shopCatalogHtml(state.catalog, state.cart) + shopOrdersHtml(state.orders)
  paintMessages()
}

function updateCart() {
  const host = state.panel?.querySelector('[data-shop-cart]')
  if (!host) return
  host.innerHTML = shopCartInnerHtml(state.catalog, state.cart)
  appendMessage(host, state.cartMessage, state.cartMessage.startsWith('[ERR]'))
}

function pruneCart() {
  const byId = new Map(state.catalog.map((item) => [String(item.id), item]))
  for (const [id, quantity] of state.cart) {
    const item = byId.get(String(id))
    if (!item || safeStock(item.stock) <= 0) {
      state.cart.delete(id)
    } else {
      state.cart.set(id, shopCoerceQuantity(quantity, safeStock(item.stock)))
    }
  }
}

function safeStock(value) {
  const stock = Number(value)
  return Number.isSafeInteger(stock) && stock >= 0 ? stock : 0
}

async function refresh() {
  try {
    const [catalog, orders] = await Promise.all([
      shopApi.getCatalog(),
      shopApi.getOrders(),
    ])
    state.catalog = Array.isArray(catalog) ? catalog : []
    state.orders = Array.isArray(orders) ? orders : []
    pruneCart()
    render()
  } catch (error) {
    state.cartMessage = '[ERR] НЕ УДАЛОСЬ ЗАГРУЗИТЬ КАТАЛОГ'
    state.orderMessage = '[ERR] НЕ УДАЛОСЬ ЗАГРУЗИТЬ ЗАКАЗЫ'
    render()
    console.error('shop load:', error)
  }
}

function cartLines() {
  return [...state.cart]
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }))
}

function bind(panel) {
  panel.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-shop-qty]')
    if (!input) return
    const id = input.dataset.shopQty
    const item = state.catalog.find((entry) => String(entry.id) === id)
    const quantity = shopCoerceQuantity(input.value, item ? safeStock(item.stock) : 0)
    if (quantity > 0) state.cart.set(id, quantity)
    else state.cart.delete(id)
    state.cartMessage = ''
    updateCart()
  })

  panel.addEventListener('click', async (event) => {
    if (state.busy) return

    if (event.target.closest?.('[data-shop-submit]')) {
      const lines = cartLines()
      if (!lines.length) {
        state.cartMessage = '[ERR] ВЫБЕРИТЕ ТОВАРЫ'
        updateCart()
        return
      }
      state.busy = true
      state.cartMessage = ''
      try {
        await shopApi.createOrder(lines)
        state.cart.clear()
        state.cartMessage = '[OK] ЗАКАЗ СОЗДАН'
        state.orderMessage = ''
        await refresh()
      } catch (error) {
        state.cartMessage = '[ERR] ЗАКАЗ НЕ СОЗДАН'
        updateCart()
        console.error('shop create order:', error)
      } finally {
        state.busy = false
      }
      return
    }

    const cancel = event.target.closest?.('[data-shop-cancel]')
    if (cancel) {
      state.busy = true
      state.orderMessage = ''
      try {
        await shopApi.cancelOrder(cancel.dataset.shopCancel)
        state.orderMessage = '[OK] ЗАКАЗ ОТМЕНЁН'
        await refresh()
      } catch (error) {
        state.orderMessage = '[ERR] ОТМЕНА НЕ ВЫПОЛНЕНА'
        paintMessages()
        console.error('shop cancel order:', error)
      } finally {
        state.busy = false
      }
    }
  })
}

export async function mountShopTab(root) {
  const panel = root.querySelector('[data-shop-panel="shop"]')
  if (!panel) return

  if (state.panel !== panel) {
    state.panel = panel
    state.cart = new Map()
    state.catalog = []
    state.orders = []
    state.cartMessage = ''
    state.orderMessage = ''
  }

  if (panel.dataset.shopBound !== '1') {
    panel.dataset.shopBound = '1'
    bind(panel)
  }

  if (panel.dataset.shopLoaded !== '1') {
    panel.dataset.shopLoaded = '1'
    await refresh()
  }
}
