import { callRpc, getTreasury } from '../api.js'
import { formatMoney } from '../format.js'

function showMessage(element, text, isError) {
  element.textContent = text
  const color = isError ? 'var(--error)' : 'var(--fg)'
  element.style.color = color
  element.style.textShadow = `0 0 6px ${color}`
  element.hidden = false
}

export function mountTreasury(container) {
  container.innerHTML = `
    <form class="login__form" data-treasury-form style="max-width: 640px;">
      <p class="login__label" style="text-align: center;">КАЗНА ФРАКЦИИ: <span data-treasury-balance>—</span></p>
      <label class="login__label" for="treasury-amount">СУММА (СО ЗНАКОМ)</label>
      <input class="input" id="treasury-amount" data-treasury-amount type="number" step="1" inputmode="numeric" placeholder="+1000 / -1000" required>
      <label class="login__label" for="treasury-comment">КОММЕНТАРИЙ</label>
      <input class="input" id="treasury-comment" data-treasury-comment type="text" autocomplete="off" required>
      <button class="btn" type="submit">ПРИМЕНИТЬ</button>
      <p class="login__error" data-treasury-message role="alert" hidden></p>
    </form>
  `

  const form = container.querySelector('[data-treasury-form]')
  const balance = container.querySelector('[data-treasury-balance]')
  const amountInput = container.querySelector('[data-treasury-amount]')
  const commentInput = container.querySelector('[data-treasury-comment]')
  const message = container.querySelector('[data-treasury-message]')
  const button = form.querySelector('button[type="submit"]')

  async function refreshBalance() {
    try {
      const treasury = await getTreasury()
      const value = Number(treasury?.balance ?? treasury ?? 0) || 0
      balance.textContent = formatMoney(value)
    } catch (error) {
      balance.textContent = 'Н/Д'
      console.error('refreshBalance:', error)
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    message.hidden = true

    const raw = amountInput.value.trim()
    const amount = Number(raw)
    const comment = commentInput.value.trim()

    if (raw === '' || !Number.isSafeInteger(amount) || amount === 0) {
      showMessage(message, 'ВВЕДИТЕ ЦЕЛОЕ ЧИСЛО СО ЗНАКОМ', true)
      return
    }
    if (!comment) {
      showMessage(message, 'УКАЖИТЕ КОММЕНТАРИЙ', true)
      return
    }

    button.disabled = true
    try {
      await callRpc('adjust_treasury', { p_amount: amount, p_comment: comment })
      amountInput.value = ''
      commentInput.value = ''
      showMessage(message, 'КАЗНА ОБНОВЛЕНА', false)
      await refreshBalance()
    } catch (error) {
      showMessage(message, 'ОШИБКА ПРАВКИ КАЗНЫ', true)
      console.error('mountTreasury:', error)
    } finally {
      button.disabled = false
    }
  })

  void refreshBalance()
}
