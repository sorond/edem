import { callRpc } from '../api.js'

const FIELDS = [
  { key: 'base_payout', label: 'БАЗОВАЯ ВЫПЛАТА В ДЕНЬ' },
  { key: 'base_tax', label: 'БАЗОВЫЙ НАЛОГ, %' },
  { key: 'min_tax', label: 'МИНИМАЛЬНЫЙ НАЛОГ, %' },
  { key: 'max_tax', label: 'МАКСИМАЛЬНЫЙ НАЛОГ, %' },
  { key: 'treasury_cap', label: 'ПОТОЛОК КАЗНЫ' },
  { key: 'tariff_external', label: 'ВНЕШНИЙ ТАРИФ' },
  { key: 'tariff_internal', label: 'ВНУТРЕННИЙ ТАРИФ' },
  { key: 'task_tariff_percent', label: 'ТАРИФ РАПОРТА С ЗАДАНИЕМ, %' },
]

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

function readNumber(raw) {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function mountSettings(container, settings) {
  const values = settings && typeof settings === 'object' ? settings : {}
  const baseline = new Map(FIELDS.map(({ key }) => [key, String(values[key] ?? '')]))

  container.innerHTML = `
    <form class="login__form" data-settings-form style="max-width: 640px;">
      ${FIELDS.map(({ key, label }) => `
        <label class="login__label" for="setting-${key}">${label}</label>
        <input class="input" id="setting-${key}" data-setting-key="${key}" type="number" step="any" value="${escapeHtml(baseline.get(key))}" required>
      `).join('')}
      <button class="btn" type="submit">СОХРАНИТЬ НАСТРОЙКИ</button>
      <p class="login__error" data-settings-message role="alert" hidden></p>
    </form>
  `

  const form = container.querySelector('[data-settings-form]')
  const message = container.querySelector('[data-settings-message]')
  const button = form.querySelector('button[type="submit"]')

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    message.hidden = true

    const entries = FIELDS.map(({ key }) => {
      const raw = form.querySelector(`[data-setting-key="${key}"]`).value.trim()
      return { key, raw, value: readNumber(raw) }
    })

    if (entries.some((entry) => entry.value === null)) {
      showMessage(message, 'ВВЕДИТЕ КОРРЕКТНЫЕ ЧИСЛА', true)
      return
    }

    const changed = entries.filter((entry) => entry.raw !== baseline.get(entry.key))
    if (!changed.length) {
      showMessage(message, 'ИЗМЕНЕНИЙ НЕТ', false)
      return
    }

    button.disabled = true
    try {
      for (const entry of changed) {
        await callRpc('update_settings', { p_key: entry.key, p_value: entry.value })
        baseline.set(entry.key, entry.raw)
      }
      showMessage(message, 'НАСТРОЙКИ СОХРАНЕНЫ', false)
    } catch (error) {
      showMessage(message, 'ОШИБКА СОХРАНЕНИЯ НАСТРОЕК', true)
      console.error('mountSettings:', error)
    } finally {
      button.disabled = false
    }
  })
}
