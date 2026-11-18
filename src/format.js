export function formatMoney(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatPercent(value) {
  return String(value) + '%'
}
