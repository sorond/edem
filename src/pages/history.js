import { getHistory } from '../api.js'
import { isShopHistoryRow, shopAmountNote } from '../historyView.js'

const CELL = 'style="border: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top;"'
const NOTE_CELL = 'style="border: 1px solid var(--border); padding: 8px; text-align: left; color: var(--fg-dim);"'

const FILTERS = [
  { id: 'all', label: 'Все', entities: null },
  { id: 'withdrawal', label: 'Выплаты', entities: ['withdrawal'] },
  { id: 'report', label: 'Рапорты', entities: ['report'] },
  { id: 'task', label: 'Задания', entities: ['task'] },
  { id: 'shop', label: 'Магазин', entities: ['shop_item', 'shop_order'] },
]

const ACTION_LABEL = {
  adjust_treasury: 'ПРАВКА КАЗНЫ',
  daily_payout: 'ЕЖЕДНЕВНАЯ ВЫПЛАТА',
  review_report: 'ПРОВЕРКА РАПОРТА',
  create_report: 'СОЗДАНИЕ РАПОРТА',
  request_withdrawal: 'ЗАПРОС ВЫПЛАТЫ',
  review_withdrawal: 'ПРОВЕРКА ВЫПЛАТЫ',
  task_failed: 'ПРОСРОЧКА ЗАДАНИЯ',
  create_task: 'СОЗДАНИЕ ЗАДАНИЯ',
  archive_task: 'АРХИВАЦИЯ ЗАДАНИЯ',
  create_tax_event: 'НАЛОГОВОЕ СОБЫТИЕ',
  update_settings: 'ИЗМЕНЕНИЕ НАСТРОЕК',
  shop_create_item: 'СОЗДАНИЕ ТОВАРА',
  shop_update_item: 'ОБНОВЛЕНИЕ ТОВАРА',
  shop_set_item_active: 'СТАТУС ТОВАРА',
  shop_create_order: 'ЗАКАЗ МАГАЗИНА',
  shop_cancel_order: 'ОТМЕНА ЗАКАЗА',
  shop_edit_order: 'РЕДАКТИРОВАНИЕ ЗАКАЗА',
  shop_approve_order: 'ОДОБРЕНИЕ ЗАКАЗА',
  shop_reject_order: 'ОТКЛОНЕНИЕ ЗАКАЗА',
  shop_rollback_order: 'ОТКАТ ЗАКАЗА',
}

const ENTITY_LABEL = {
  treasury: 'КАЗНА',
  task: 'ЗАДАНИЕ',
  report: 'РАПОРТ',
  withdrawal: 'ВЫПЛАТА',
  tax_event: 'НАЛОГ',
  settings: 'НАСТРОЙКИ',
  shop_item: 'ТОВАР',
  shop_order: 'ЗАКАЗ',
}

const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function label(map, value) {
  const raw = String(value ?? '—')
  return Object.hasOwn(map, raw) ? map[raw] : escapeHtml(raw)
}

function formatTime(value) {
  const date = new Date(value)
  if (value == null || Number.isNaN(date.getTime())) return escapeHtml(value ?? '—')
  return escapeHtml(TIME_FORMAT.format(date))
}

function timestamp(row) {
  const value = Date.parse(row.created_at)
  return Number.isFinite(value) ? value : -Infinity
}

function compareIdsDesc(a, b) {
  const left = Number(a.id)
  const right = Number(b.id)
  if (Number.isFinite(left) && Number.isFinite(right)) return right - left
  return String(b.id ?? '').localeCompare(String(a.id ?? ''))
}

function sortByNewest(rows) {
  return [...rows].sort((a, b) => {
    const left = timestamp(a)
    const right = timestamp(b)
    if (left !== right) return right - left
    return compareIdsDesc(a, b)
  })
}

function matchesFilter(row, filterId) {
  const filter = FILTERS.find((item) => item.id === filterId)
  if (!filter || filter.entities === null) return true
  if (filter.id === 'shop') return isShopHistoryRow(row)
  return filter.entities.includes(row.entity)
}

function isManualTreasuryEdit(row) {
  return row.action === 'adjust_treasury' && row.entity === 'treasury'
}

function rowHtml(row) {
  const comment = String(row.comment ?? '').trim()
  const shownComment = comment ? escapeHtml(comment) : '—'
  const amountNote = isShopHistoryRow(row) ? shopAmountNote(row) : null
  const main = `
    <tr>
      <td ${CELL}>${formatTime(row.created_at)}</td>
      <td ${CELL}>${label(ACTION_LABEL, row.action)}</td>
      <td ${CELL}>${label(ENTITY_LABEL, row.entity)}</td>
      <td ${CELL}>${isManualTreasuryEdit(row) ? '—' : shownComment}</td>
    </tr>
  `

  let extra = ''
  if (isManualTreasuryEdit(row)) {
    extra += `
    <tr>
      <td ${NOTE_CELL} colspan="4">КОММЕНТАРИЙ: ${shownComment}</td>
    </tr>
  `
  }
  if (amountNote) {
    extra += `
    <tr>
      <td ${NOTE_CELL} colspan="4">${escapeHtml(amountNote)}</td>
    </tr>
  `
  }
  return `${main}${extra}`
}

function rowsHtml(rows) {
  if (!rows.length) return `<tr><td ${CELL} colspan="4">НЕТ ЗАПИСЕЙ</td></tr>`
  return rows.map(rowHtml).join('')
}

export async function renderHistory(root) {
  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'

  let rows
  try {
    const history = await getHistory()
    rows = sortByNewest(Array.isArray(history) ? history : [])
  } catch (error) {
    root.innerHTML = '<p class="placeholder" role="alert">ОШИБКА ЗАГРУЗКИ ИСТОРИИ</p>'
    console.error('renderHistory:', error)
    return
  }

  root.innerHTML = `
    <section class="history">
      <h1 class="login__title">ИСТОРИЯ</h1>
      <div class="login__tabs" data-history-filters role="group" aria-label="ФИЛЬТР ИСТОРИИ">
        ${FILTERS.map((filter, index) => `
          <button type="button" class="tab${index === 0 ? ' tab--active' : ''}" data-filter="${filter.id}" aria-pressed="${index === 0}">${filter.label}</button>
        `).join('')}
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th ${CELL}>ВРЕМЯ</th>
            <th ${CELL}>ДЕЙСТВИЕ</th>
            <th ${CELL}>СУЩНОСТЬ</th>
            <th ${CELL}>КОММЕНТАРИЙ</th>
          </tr>
        </thead>
        <tbody data-history-rows></tbody>
      </table>
    </section>
  `

  const body = root.querySelector('[data-history-rows]')
  const buttons = root.querySelectorAll('[data-filter]')

  function paint() {
    const active = root.querySelector('.tab--active')?.dataset.filter ?? 'all'
    body.innerHTML = rowsHtml(rows.filter((row) => matchesFilter(row, active)))
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) {
        const isActive = other === button
        other.classList.toggle('tab--active', isActive)
        other.setAttribute('aria-pressed', String(isActive))
      }
      paint()
    })
  }

  paint()
}
