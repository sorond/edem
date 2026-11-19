import { callRpc, getTreasury, getTasks } from '../api.js'
import { getRole } from '../auth.js'
import { formatMoney } from '../format.js'
import { notify, playBeep } from '../notify.js'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

const SEEN_URGENT_KEY = 'edem_seen_urgent_ids'

function readSeenUrgentIds() {
  try {
    const raw = localStorage.getItem(SEEN_URGENT_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return new Set(parsed.filter((id) => typeof id === 'string' && id))
  } catch {
    return null
  }
}

function writeSeenUrgentIds(ids) {
  try {
    localStorage.setItem(SEEN_URGENT_KEY, JSON.stringify([...ids]))
  } catch {
    // Хранилище недоступно (приватный режим, лимит) — уведомления без истории.
  }
}

function announceNewUrgentTasks(tasks) {
  const ids = tasks
    .map((task) => task.id)
    .filter((id) => typeof id === 'string' && id)
  const current = new Set(ids)
  const seen = readSeenUrgentIds()

  // Первый запуск: запоминаем текущие задания, но не тревожим пользователя.
  if (!seen) {
    writeSeenUrgentIds(current)
    return
  }

  if (ids.some((id) => !seen.has(id))) {
    playBeep()
    notify('НОВОЕ СРОЧНОЕ ЗАДАНИЕ', 'warning')
  }
  for (const id of current) seen.add(id)
  writeSeenUrgentIds(seen)
}

// Пока главная открыта, задания опрашиваются повторно: срочное задание,
// созданное админом без перезагрузки страницы, всё равно должно уведомить.
const URGENT_POLL_MS = 20_000
const HOME_HASH = '#/home'

let urgentPollTimer = null
let urgentPollToken = 0
let urgentPollInFlight = false

function stopUrgentPolling() {
  if (urgentPollTimer !== null) {
    clearInterval(urgentPollTimer)
    urgentPollTimer = null
  }
}

function startUrgentPolling(token) {
  stopUrgentPolling()
  urgentPollTimer = setInterval(async () => {
    if (token !== urgentPollToken || urgentPollInFlight) return
    urgentPollInFlight = true
    try {
      const tasks = await getTasks()
      if (token !== urgentPollToken) return
      const rows = Array.isArray(tasks) ? tasks : []
      announceNewUrgentTasks(rows.filter((task) => task.kind === 'urgent'))
    } catch (error) {
      console.error('urgent poll:', error)
    } finally {
      urgentPollInFlight = false
    }
  }, URGENT_POLL_MS)
}

// Уход с главной должен останавливать опрос даже если renderHome больше не вызывается.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (location.hash !== HOME_HASH) {
      urgentPollToken += 1
      stopUrgentPolling()
    }
  })
}

function taskCard(task) {
  const title = escapeHtml(task.title ?? 'БЕЗ НАЗВАНИЯ')
  const approved = Math.max(0, Number(task.approved ?? task.approved_count ?? 0) || 0)
  const target = Math.max(0, Number(task.target_count ?? task.target ?? 0) || 0)
  const percent = target > 0 ? Math.min(100, (approved / target) * 100) : 0
  const urgent = task.kind === 'urgent'
  const shownApproved = Math.min(approved, target)

  return `
    <article class="task${urgent ? ' urgent' : ''}">
      <div class="task__head">
        <span class="task__title">${title}</span>
        <span class="task__goal">${shownApproved}/${target}</span>
      </div>
      <div class="progress" role="progressbar" aria-label="${title}" aria-valuemin="0" aria-valuemax="${Math.max(1, target)}" aria-valuenow="${shownApproved}">
        <div class="progress-fill" style="width: ${percent}%"></div>
      </div>
    </article>
  `
}

function taskColumn(title, tasks) {
  const content = tasks.length ? tasks.map(taskCard).join('') : '<p class="task-empty">НЕТ ЗАДАНИЙ</p>'
  return `
    <section class="task-column">
      <h2 class="task-column__title">${title}</h2>
      <div class="task-list">${content}</div>
    </section>
  `
}

function withdrawalFormHtml() {
  return `
    <section class="withdrawal" data-withdrawal style="margin-top: 28px; max-width: 640px;">
      <h2 class="task-column__title">ЗАПРОС ВЫПЛАТЫ</h2>
      <form class="login__form" data-withdrawal-form>
        <label class="login__label" for="withdrawal-amount">СУММА ЗАПРОСА</label>
        <input class="input" id="withdrawal-amount" name="amountGross" type="number" min="1" step="1" inputmode="numeric" placeholder="60000" required>

        <label class="login__label" for="withdrawal-comment">КОММЕНТАРИЙ</label>
        <input class="input" id="withdrawal-comment" name="comment" type="text" autocomplete="off">

        <div class="login__label" data-withdrawal-preview aria-live="polite" style="white-space: pre-line;"></div>

        <button class="btn" type="submit" data-withdrawal-submit>Отправить запрос</button>
      </form>
    </section>
  `
}

async function mountWithdrawalForm(root) {
  const form = root.querySelector('[data-withdrawal-form]')
  if (!form) return

  const amountInput = form.querySelector('[name="amountGross"]')
  const commentInput = form.querySelector('[name="comment"]')
  const preview = root.querySelector('[data-withdrawal-preview]')
  const submit = form.querySelector('[data-withdrawal-submit]')

  // Налог уже удержан при зачислении в казну, при выводе он не применяется.
  function updatePreview() {
    const amount = Number(amountInput.value)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      preview.textContent = 'ВВЕДИТЕ СУММУ'
      return
    }
    preview.textContent = `К выдаче в игре: ${formatMoney(amount)}`
  }

  form.addEventListener('input', updatePreview)
  updatePreview()

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const amountGross = Number(amountInput.value)
    if (!Number.isSafeInteger(amountGross) || amountGross <= 0) {
      notify('НЕВЕРНАЯ СУММА', 'error')
      return
    }
    submit.disabled = true
    try {
      await callRpc('request_withdrawal', {
        p_amount: amountGross,
        p_comment: commentInput.value.trim(),
      })
      form.reset()
      updatePreview()
      notify('ЗАПРОС ОТПРАВЛЕН', 'success')
    } catch (error) {
      notify('ОШИБКА ЗАПРОСА', 'error')
      console.error('request_withdrawal:', error)
    } finally {
      submit.disabled = false
    }
  })
}

export async function renderHome(root) {
  const token = ++urgentPollToken
  stopUrgentPolling()
  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'

  try {
    const [treasury, tasks, role] = await Promise.all([getTreasury(), getTasks(), getRole()])
    if (token !== urgentPollToken) return
    const balance = Number(treasury?.balance ?? treasury ?? 0) || 0
    const rows = Array.isArray(tasks) ? tasks : []
    const weekly = rows.filter((task) => task.kind !== 'urgent')
    const urgent = rows.filter((task) => task.kind === 'urgent')

    announceNewUrgentTasks(urgent)

    root.innerHTML = `
      <section class="home">
        <div class="treasury">
          <div class="treasury__label">КАЗНА ФРАКЦИИ</div>
          <div class="treasury__amount">${formatMoney(balance)}</div>
        </div>
        <div class="task-columns">
          ${taskColumn('ЕЖЕНЕДЕЛЬНЫЕ', weekly)}
          ${taskColumn('СРОЧНЫЕ', urgent)}
        </div>
        ${role === 'curator' ? withdrawalFormHtml() : ''}
      </section>
    `

    if (role === 'curator') await mountWithdrawalForm(root)
    if (token !== urgentPollToken) return
    startUrgentPolling(token)
  } catch (error) {
    if (token !== urgentPollToken) return
    root.innerHTML = '<p class="placeholder" role="alert">ОШИБКА ЗАГРУЗКИ ДАННЫХ</p>'
    console.error('renderHome:', error)
  }
}
