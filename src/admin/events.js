import { callRpc, getTaxEvents } from '../api.js'

const CELL = 'style="border: 1px solid var(--border); padding: 8px; text-align: left;"'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function showMessage(element, text, isError) {
  element.textContent = text
  const color = isError ? 'var(--error)' : 'var(--fg)'
  element.style.color = color
  element.style.textShadow = `0 0 6px ${color}`
  element.hidden = false
}

function isActive(event) {
  const now = Date.now()
  const starts = event.starts_at ? Date.parse(event.starts_at) : -Infinity
  const ends = event.ends_at ? Date.parse(event.ends_at) : Infinity
  if (Number.isNaN(starts) || Number.isNaN(ends)) return false
  return starts <= now && ends > now
}

function eventRowsHtml(events) {
  const rows = events.map((event) => {
    const shift = Number(event.shift) || 0
    const shiftText = `${shift > 0 ? '+' : ''}${escapeHtml(shift)}%`
    return `
      <tr>
        <td ${CELL}>${escapeHtml(event.name ?? 'БЕЗ НАЗВАНИЯ')}</td>
        <td ${CELL}>${shiftText}</td>
        <td ${CELL}>${escapeHtml(event.ends_at ?? '—')}</td>
      </tr>
    `
  })

  return rows.length ? rows.join('') : `<tr><td ${CELL} colspan="3">НЕТ АКТИВНЫХ СОБЫТИЙ</td></tr>`
}

async function refreshEventList(container) {
  const body = container.querySelector('[data-active-events]')
  try {
    const events = await getTaxEvents()
    const active = (Array.isArray(events) ? events : []).filter(isActive)
    body.innerHTML = eventRowsHtml(active)
  } catch (error) {
    body.innerHTML = `<tr><td ${CELL} colspan="3">ОШИБКА ЗАГРУЗКИ СОБЫТИЙ</td></tr>`
    console.error('refreshEventList:', error)
  }
}

export function mountEvents(container) {
  container.innerHTML = `
    <form class="login__form" data-event-form style="max-width: 640px;">
      <label class="login__label" for="event-name">НАЗВАНИЕ</label>
      <input class="input" id="event-name" name="name" type="text" autocomplete="off" required>

      <label class="login__label" for="event-shift">СДВИГ НАЛОГА, %</label>
      <input class="input" id="event-shift" name="shift" type="number" step="any" placeholder="+10 / -10" required>

      <label class="login__label" for="event-days">ДЛИТЕЛЬНОСТЬ, ДНИ</label>
      <input class="input" id="event-days" name="days" type="number" step="1" min="1" required>

      <button class="btn" type="submit">СОЗДАТЬ СОБЫТИЕ</button>
      <p class="login__error" data-event-message role="alert" hidden></p>
    </form>

    <h2 class="task-column__title" style="margin-top: 32px;">АКТИВНЫЕ СОБЫТИЯ</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th ${CELL}>НАЗВАНИЕ</th>
          <th ${CELL}>СДВИГ</th>
          <th ${CELL}>ОКОНЧАНИЕ</th>
        </tr>
      </thead>
      <tbody data-active-events><tr><td ${CELL} colspan="3">ЗАГРУЗКА...</td></tr></tbody>
    </table>
  `

  const form = container.querySelector('[data-event-form]')
  const message = container.querySelector('[data-event-message]')
  const button = form.querySelector('button[type="submit"]')

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    message.hidden = true

    const name = form.querySelector('[name="name"]').value.trim()
    const rawShift = form.querySelector('[name="shift"]').value.trim()
    const rawDays = form.querySelector('[name="days"]').value.trim()
    const shift = rawShift === '' ? null : Number(rawShift)
    const days = rawDays === '' ? null : Number(rawDays)

    if (!name) {
      showMessage(message, 'УКАЖИТЕ НАЗВАНИЕ', true)
      return
    }
    if (shift === null || !Number.isFinite(shift)) {
      showMessage(message, 'ВВЕДИТЕ КОРРЕКТНЫЙ СДВИГ НАЛОГА', true)
      return
    }
    if (days === null || !Number.isSafeInteger(days) || days <= 0) {
      showMessage(message, 'ДЛИТЕЛЬНОСТЬ ДОЛЖНА БЫТЬ ПОЛОЖИТЕЛЬНЫМ ЦЕЛЫМ ЧИСЛОМ', true)
      return
    }

    button.disabled = true
    try {
      await callRpc('create_tax_event', { p_name: name, p_shift: shift, p_days: days })
      form.reset()
      showMessage(message, 'СОБЫТИЕ СОЗДАНО', false)
      await refreshEventList(container)
    } catch (error) {
      showMessage(message, 'ОШИБКА СОЗДАНИЯ СОБЫТИЯ', true)
      console.error('mountEvents:', error)
    } finally {
      button.disabled = false
    }
  })

  void refreshEventList(container)
}
