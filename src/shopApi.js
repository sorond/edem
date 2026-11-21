// api.js resolves @supabase/supabase-js through the browser import map;
// load it only when the real client is needed so unit tests stay offline.
async function defaultInvoke(name, params) {
  const { callRpc } = await import('./api.js')
  return callRpc(name, params)
}

export function makeShopApi(invoke = defaultInvoke) {
  return {
    getCatalog: () => invoke('shop_get_catalog'),
    getOrders: () => invoke('shop_get_orders'),
    createItem: (item) => invoke('shop_create_item', {
      p_name: item.name,
      p_icon: item.icon,
      p_category: item.category,
      p_stock: item.stock,
      p_price: item.price,
    }),
    updateItem: (id, item) => invoke('shop_update_item', {
      p_id: id,
      p_name: item.name,
      p_icon: item.icon,
      p_category: item.category,
      p_stock: item.stock,
      p_price: item.price,
    }),
    setItemActive: (id, active) => invoke('shop_set_item_active', {
      p_id: id,
      p_active: active,
    }),
    createOrder: (items) => invoke('shop_create_order', { p_items: items }),
    cancelOrder: (id) => invoke('shop_cancel_order', { p_order_id: id }),
    editOrder: (id, items) => invoke('shop_edit_order', {
      p_order_id: id,
      p_items: items,
    }),
    reviewOrder: (id, approve) => invoke('shop_review_order', {
      p_order_id: id,
      p_approve: approve,
    }),
    rollbackOrder: (id) => invoke('shop_rollback_order', { p_order_id: id }),
  }
}

export const shopApi = makeShopApi()
