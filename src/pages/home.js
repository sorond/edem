import { getTreasury, getTasks } from '../api.js'
import { formatMoney } from '../format.js'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
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

export async function renderHome(root) {
  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'

  try {
    const [treasury, tasks] = await Promise.all([getTreasury(), getTasks()])
    const balance = Number(treasury?.balance ?? treasury ?? 0) || 0
    const rows = Array.isArray(tasks) ? tasks : []
    const weekly = rows.filter((task) => task.kind !== 'urgent')
    const urgent = rows.filter((task) => task.kind === 'urgent')

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
      </section>
    `
  } catch (error) {
    root.innerHTML = '<p class="placeholder" role="alert">ОШИБКА ЗАГРУЗКИ ДАННЫХ</p>'
    console.error('renderHome:', error)
  }
}
