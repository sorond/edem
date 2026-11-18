import { getTasks, getReports, callRpc, supabase } from '../api.js'
import { buildReportPayload } from '../reportForm.js'

const BUCKET = 'report-screenshots'
const CELL = 'style="border: 1px solid var(--border); padding: 8px; text-align: left;"'

const STATUS = {
  pending: { label: 'НА ПРОВЕРКЕ', color: 'var(--warning)' },
  approved: { label: 'ПРИНЯТ', color: 'var(--fg)' },
  rejected: { label: 'ОТКЛОНЁН', color: 'var(--error)' },
}

const TYPE_LABEL = {
  external: 'ВНЕШНЕЕ',
  internal: 'ВНУТРЕННЕЕ',
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

function statusCell(status) {
  const meta = STATUS[status] ?? { label: escapeHtml(status ?? 'НЕИЗВЕСТНО'), color: 'var(--fg-dim)' }
  const className = Object.hasOwn(STATUS, status) ? `report-status--${status}` : 'report-status--unknown'
  return `<span class="report-status ${className}" style="color: ${meta.color}; text-shadow: 0 0 6px ${meta.color};">${meta.label}</span>`
}

function reportRowsHtml(reports, tasks) {
  const titles = new Map(tasks.map((task) => [task.id, task.title ?? task.id]))
  const rows = reports.map((report) => {
    const taskTitle = report.task_id ? (titles.get(report.task_id) ?? report.task_id) : '—'
    const type = TYPE_LABEL[report.interaction_type] ?? escapeHtml(report.interaction_type ?? '—')
    return `
      <tr>
        <td ${CELL}>${escapeHtml(report.report_date ?? '—')}</td>
        <td ${CELL}>${escapeHtml(report.player_a ?? '')} / ${escapeHtml(report.player_b ?? '')}</td>
        <td ${CELL}>${type}</td>
        <td ${CELL}>${escapeHtml(taskTitle)}</td>
        <td ${CELL}>${statusCell(report.status)}</td>
      </tr>
    `
  })

  return rows.length ? rows.join('') : `<tr><td ${CELL} colspan="5">НЕТ РАПОРТОВ</td></tr>`
}

function taskOptionsHtml(tasks) {
  const options = tasks.map((task) => {
    const title = escapeHtml(task.title ?? 'БЕЗ НАЗВАНИЯ')
    return `<option value="${escapeHtml(task.id)}">${title}</option>`
  })
  return `<option value="">БЕЗ ЗАДАНИЯ</option>${options.join('')}`
}

async function refreshReportList(root) {
  const [tasks, reports] = await Promise.all([getTasks(), getReports()])
  const body = root.querySelector('[data-report-rows]')
  if (body) {
    body.innerHTML = reportRowsHtml(
      Array.isArray(reports) ? reports : [],
      Array.isArray(tasks) ? tasks : [],
    )
  }
}

function showMessage(element, text, isError) {
  element.textContent = text
  const color = isError ? 'var(--error)' : 'var(--fg)'
  element.style.color = color
  element.style.textShadow = `0 0 6px ${color}`
  element.hidden = false
}

function safeFileName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

function todayIso() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

async function removeUploads(paths) {
  if (!paths.length) return
  const result = await supabase.storage.from(BUCKET).remove(paths)
  if (result?.error) console.error('cleanup:', result.error)
}

async function uploadScreenshots(files) {
  const storage = supabase.storage.from(BUCKET)
  const paths = []
  try {
    for (const [index, file] of files.entries()) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}-${index}-${safeFileName(file.name)}`
      const { error } = await storage.upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
      if (error) throw error
      paths.push(path)
    }
    return {
      paths,
      urls: paths.map((path) => storage.getPublicUrl(path).data.publicUrl),
    }
  } catch (error) {
    try {
      await removeUploads(paths)
    } catch (cleanupError) {
      console.error('cleanup:', cleanupError)
    }
    throw error
  }
}

async function submitReport(event, form, message, root) {
  event.preventDefault()
  message.hidden = true
  const button = form.querySelector('button[type="submit"]')
  const fileInput = form.querySelector('[data-report-screenshots]')
  const files = Array.from(fileInput?.files ?? [])
  let uploaded = { paths: [], urls: [] }

  if (button) button.disabled = true
  try {
    uploaded = await uploadScreenshots(files)
    await callRpc('create_report', buildReportPayload(new FormData(form), uploaded.urls))
    form.reset()
    try {
      await refreshReportList(root)
    } catch (refreshError) {
      console.error('refreshReportList:', refreshError)
    }
    showMessage(message, 'РАПОРТ ОТПРАВЛЕН', false)
  } catch (error) {
    try {
      await removeUploads(uploaded.paths)
    } catch (cleanupError) {
      console.error('cleanup:', cleanupError)
    }
    showMessage(message, 'ОШИБКА ОТПРАВКИ РАПОРТА', true)
    console.error('submitReport:', error)
  } finally {
    if (button) button.disabled = false
  }
}

export async function renderReports(root) {
  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'

  try {
    const [tasks, reports] = await Promise.all([getTasks(), getReports()])
    const taskRows = Array.isArray(tasks) ? tasks : []
    const reportRows = Array.isArray(reports) ? reports : []

    root.innerHTML = `
      <section class="reports">
        <h1 class="login__title">РАПОРТЫ</h1>
        <form class="login__form report-form" style="max-width: 640px; margin-bottom: 32px;">
          <label class="login__label" for="report-date">ДАТА</label>
          <input class="input" id="report-date" name="reportDate" type="date" value="${todayIso()}" required>

          <label class="login__label" for="report-player-a">КТО</label>
          <input class="input" id="report-player-a" name="playerA" type="text" autocomplete="off" required>

          <label class="login__label" for="report-player-b">С КЕМ</label>
          <input class="input" id="report-player-b" name="playerB" type="text" autocomplete="off" required>

          <label class="login__label" for="report-type">ТИП ВЗАИМОДЕЙСТВИЯ</label>
          <select class="input" id="report-type" name="interactionType">
            <option value="external">ВНЕШНЕЕ</option>
            <option value="internal">ВНУТРЕННЕЕ</option>
          </select>

          <label class="login__label" for="report-task">ЗАДАНИЕ</label>
          <select class="input" id="report-task" name="taskId">${taskOptionsHtml(taskRows)}</select>

          <label class="login__label" for="report-description">ОПИСАНИЕ</label>
          <textarea class="input" id="report-description" name="description" rows="4"></textarea>

          <label class="login__label" for="report-screenshots">СКРИНШОТЫ</label>
          <input class="input" id="report-screenshots" data-report-screenshots type="file" accept="image/*" multiple>

          <button class="btn" type="submit">ОТПРАВИТЬ РАПОРТ</button>
          <p class="login__error" data-report-message role="alert" hidden></p>
        </form>

        <h2 class="task-column__title">СПИСОК РАПОРТОВ</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th ${CELL}>ДАТА</th>
              <th ${CELL}>ИГРОКИ</th>
              <th ${CELL}>ТИП</th>
              <th ${CELL}>ЗАДАНИЕ</th>
              <th ${CELL}>СТАТУС</th>
            </tr>
          </thead>
          <tbody data-report-rows>${reportRowsHtml(reportRows, taskRows)}</tbody>
        </table>
      </section>
    `

    const form = root.querySelector('.report-form')
    const message = root.querySelector('[data-report-message]')
    form.addEventListener('submit', (event) => {
      void submitReport(event, form, message, root)
    })
  } catch (error) {
    root.innerHTML = '<p class="placeholder" role="alert">ОШИБКА ЗАГРУЗКИ РАПОРТОВ</p>'
    console.error('renderReports:', error)
  }
}
