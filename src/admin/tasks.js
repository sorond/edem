import { callRpc, getTasks } from '../api.js'

const CELL = 'style="border: 1px solid var(--border); padding: 8px; text-align: left;"'

const KIND_LABEL = {
  weekly: 'ЕЖЕНЕДЕЛЬНОЕ',
  urgent: 'СРОЧНОЕ',
}

const STATUS_LABEL = {
  active: 'АКТИВНО',
  completed: 'ВЫПОЛНЕНО',
  failed: 'ПРОВАЛЕНО',
  archived: 'В АРХИВЕ',
}

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

function readInteger(raw) {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

function readNumber(raw) {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function taskRowsHtml(tasks) {
  const rows = tasks.map((task) => {
    const title = escapeHtml(task.title ?? 'БЕЗ НАЗВАНИЯ')
    const kind = KIND_LABEL[task.kind] ?? escapeHtml(task.kind ?? '—')
    const status = STATUS_LABEL[task.status] ?? escapeHtml(task.status ?? '—')
    const approved = Math.max(0, Number(task.approved_count ?? 0) || 0)
    const target = Math.max(0, Number(task.target_count ?? 0) || 0)
    const progress = `${Math.min(approved, target)}/${target}`

    return `
      <tr>
        <td ${CELL}>${title}</td>
        <td ${CELL}>${kind}</td>
        <td ${CELL}>${progress}</td>
        <td ${CELL}>${status}</td>
        <td ${CELL}><button class="btn" type="button" data-archive-task="${escapeHtml(task.id ?? '')}">В АРХИВ</button></td>
      </tr>
    `
  })

  return rows.length ? rows.join('') : `<tr><td ${CELL} colspan="5">НЕТ АКТИВНЫХ ЗАДАНИЙ</td></tr>`
}

async function refreshTaskList(container) {
  const body = container.querySelector('[data-active-tasks]')
  try {
    const tasks = await getTasks()
    const active = (Array.isArray(tasks) ? tasks : []).filter((task) => task.status === 'active')
    body.innerHTML = taskRowsHtml(active)
  } catch (error) {
    body.innerHTML = `<tr><td ${CELL} colspan="5">ОШИБКА ЗАГРУЗКИ ЗАДАНИЙ</td></tr>`
    console.error('refreshTaskList:', error)
  }
}

export function mountTasks(container) {
  container.innerHTML = `
    <form class="login__form" data-task-form style="max-width: 640px;">
      <label class="login__label" for="task-kind">ТИП</label>
      <select class="input" id="task-kind" name="kind">
        <option value="weekly">ЕЖЕНЕДЕЛЬНОЕ</option>
        <option value="urgent">СРОЧНОЕ</option>
      </select>

      <label class="login__label" for="task-title">НАЗВАНИЕ</label>
      <input class="input" id="task-title" name="title" type="text" autocomplete="off" required>

      <label class="login__label" for="task-description">ОПИСАНИЕ</label>
      <textarea class="input" id="task-description" name="description" rows="3"></textarea>

      <label class="login__label" for="task-target">ЦЕЛЬ В РАПОРТАХ</label>
      <input class="input" id="task-target" name="target" type="number" step="1" min="1" required>

      <label class="login__label" for="task-bonus">БОНУС К ВЫПЛАТЕ, %</label>
      <input class="input" id="task-bonus" name="bonus" type="number" step="any" min="0" value="0">

      <label class="login__label" for="task-reward">НАГРАДА GROSS</label>
      <input class="input" id="task-reward" name="reward" type="number" step="1" min="0" value="0">

      <label class="login__label" for="task-penalty">ШТРАФ: СДВИГ НАЛОГА, %</label>
      <input class="input" id="task-penalty" name="penalty" type="number" step="any" min="0" value="0">

      <label class="login__label" for="task-penalty-days">ШТРАФ: ДЛИТЕЛЬНОСТЬ, ДНИ</label>
      <input class="input" id="task-penalty-days" name="penaltyDays" type="number" step="1" min="0" value="7">

      <label class="login__label" for="task-has-bonus" style="display: flex; align-items: center; gap: 8px;">
        <input id="task-has-bonus" name="hasBonus" type="checkbox" style="width: auto;">
        БОНУС ДЛЯ СРОЧНОГО
      </label>

      <button class="btn" type="submit">СОЗДАТЬ ЗАДАНИЕ</button>
      <p class="login__error" data-task-message role="alert" hidden></p>
    </form>

    <h2 class="task-column__title" style="margin-top: 32px;">АКТИВНЫЕ ЗАДАНИЯ</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th ${CELL}>НАЗВАНИЕ</th>
          <th ${CELL}>ТИП</th>
          <th ${CELL}>ПРОГРЕСС</th>
          <th ${CELL}>СТАТУС</th>
          <th ${CELL}>ДЕЙСТВИЕ</th>
        </tr>
      </thead>
      <tbody data-active-tasks><tr><td ${CELL} colspan="5">ЗАГРУЗКА...</td></tr></tbody>
    </table>
    <p class="login__error" data-task-list-message role="alert" hidden></p>
  `

  const form = container.querySelector('[data-task-form]')
  const message = container.querySelector('[data-task-message]')
  const listMessage = container.querySelector('[data-task-list-message]')
  const body = container.querySelector('[data-active-tasks]')
  const button = form.querySelector('button[type="submit"]')

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    message.hidden = true

    const title = form.querySelector('[name="title"]').value.trim()
    const description = form.querySelector('[name="description"]').value.trim()
    const kind = form.querySelector('[name="kind"]').value
    const target = readInteger(form.querySelector('[name="target"]').value.trim())
    const bonus = readNumber(form.querySelector('[name="bonus"]').value.trim())
    const reward = readInteger(form.querySelector('[name="reward"]').value.trim())
    const penalty = readNumber(form.querySelector('[name="penalty"]').value.trim())
    const penaltyDays = readInteger(form.querySelector('[name="penaltyDays"]').value.trim())
    const hasBonus = form.querySelector('[name="hasBonus"]').checked

    if (!title) {
      showMessage(message, 'УКАЖИТЕ НАЗВАНИЕ', true)
      return
    }
    if (kind !== 'weekly' && kind !== 'urgent') {
      showMessage(message, 'ВЫБЕРИТЕ ТИП ЗАДАНИЯ', true)
      return
    }
    if (target === null || target <= 0) {
      showMessage(message, 'ЦЕЛЬ ДОЛЖНА БЫТЬ ПОЛОЖИТЕЛЬНЫМ ЦЕЛЫМ ЧИСЛОМ', true)
      return
    }
    if (bonus === null || bonus < 0 || penalty === null || penalty < 0) {
      showMessage(message, 'ВВЕДИТЕ КОРРЕКТНЫЕ ПРОЦЕНТЫ', true)
      return
    }
    if (reward === null || reward < 0) {
      showMessage(message, 'НАГРАДА ДОЛЖНА БЫТЬ ЦЕЛЫМ ЧИСЛОМ', true)
      return
    }
    if (penaltyDays === null || penaltyDays < 0) {
      showMessage(message, 'СРОК ШТРАФА ДОЛЖЕН БЫТЬ ЦЕЛЫМ ЧИСЛОМ', true)
      return
    }

    button.disabled = true
    try {
      await callRpc('create_task', {
        p_title: title,
        p_description: description,
        p_kind: kind,
        p_target: target,
        p_bonus: bonus,
        p_reward: reward,
        p_penalty: penalty,
        p_penalty_days: penaltyDays,
        p_has_bonus: hasBonus,
      })
      form.reset()
      showMessage(message, 'ЗАДАНИЕ СОЗДАНО', false)
      await refreshTaskList(container)
    } catch (error) {
      showMessage(message, 'ОШИБКА СОЗДАНИЯ ЗАДАНИЯ', true)
      console.error('mountTasks:', error)
    } finally {
      button.disabled = false
    }
  })

  body.addEventListener('click', async (event) => {
    const buttonArchive = event.target.closest('[data-archive-task]')
    if (!buttonArchive) return

    const id = buttonArchive.getAttribute('data-archive-task')
    if (!id) return

    listMessage.hidden = true
    buttonArchive.disabled = true
    try {
      await callRpc('archive_task', { p_id: id })
      await refreshTaskList(container)
      showMessage(listMessage, 'ЗАДАНИЕ ОТПРАВЛЕНО В АРХИВ', false)
    } catch (error) {
      buttonArchive.disabled = false
      showMessage(listMessage, 'ОШИБКА АРХИВАЦИИ ЗАДАНИЯ', true)
      console.error('archiveTask:', error)
    }
  })

  void refreshTaskList(container)
}
