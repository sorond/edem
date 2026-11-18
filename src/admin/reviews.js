import { callRpc, getReports, getWithdrawals } from '../api.js'
import { formatMoney, formatPercent } from '../format.js'
import { notify } from '../notify.js'

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

function showMessage(element, text) {
  element.textContent = text
  element.hidden = false
}

function safeUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function screenshotsHtml(value) {
  let urls = value
  if (typeof urls === 'string') {
    try {
      urls = JSON.parse(urls)
    } catch {
      urls = []
    }
  }
  if (!Array.isArray(urls)) urls = []

  const links = urls
    .map(safeUrl)
    .filter(Boolean)
    .map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">СКРИНШОТ ${index + 1}</a>`)

  return links.length ? `<div class="login__label">СКРИНШОТЫ: ${links.join(' · ')}</div>` : ''
}

function reviewActionsHtml() {
  return `
    <input class="input" data-review-comment type="text" aria-label="КОММЕНТАРИЙ" placeholder="КОММЕНТАРИЙ (НЕОБЯЗАТЕЛЬНО)" autocomplete="off" style="margin-top: 10px;">
    <div style="display: flex; gap: 8px; margin-top: 10px;">
      <button class="btn" type="button" data-review-decision="approved">ПРИНЯТЬ</button>
      <button class="btn" type="button" data-review-decision="rejected">ОТКЛОНИТЬ</button>
    </div>
  `
}

function reportCardHtml(report) {
  const type = TYPE_LABEL[report.interaction_type] ?? escapeHtml(report.interaction_type ?? '—')
  return `
    <article class="task" data-review-card="report" data-review-id="${escapeHtml(report.id ?? '')}">
      <div class="task__head">
        <span class="task__title">ОТ: ${escapeHtml(report.reporter ?? '—')}</span>
        <span class="task__goal">${escapeHtml(report.report_date ?? '—')}</span>
      </div>
      <div class="login__label">ИГРОКИ: ${escapeHtml(report.player_a ?? '—')} / ${escapeHtml(report.player_b ?? '—')}</div>
      <div class="login__label">ТИП: ${type}</div>
      <div class="login__label">ЗАДАНИЕ: ${escapeHtml(report.task_id ?? '—')}</div>
      <div class="login__label">ОПИСАНИЕ: ${escapeHtml(report.description ?? '—')}</div>
      ${screenshotsHtml(report.screenshot_urls)}
      ${reviewActionsHtml()}
    </article>
  `
}

function withdrawalCardHtml(withdrawal) {
  const gross = formatMoney(Number(withdrawal.amount_gross ?? 0))
  const tax = formatMoney(Number(withdrawal.tax_amount ?? 0))
  const net = formatMoney(Number(withdrawal.amount_net ?? 0))
  const rate = formatPercent(Number(withdrawal.tax_rate ?? 0))
  return `
    <article class="task" data-review-card="withdrawal" data-review-id="${escapeHtml(withdrawal.id ?? '')}">
      <div class="task__head">
        <span class="task__title">КУРАТОР: ${escapeHtml(withdrawal.curator ?? '—')}</span>
        <span class="task__goal">${escapeHtml(withdrawal.created_at ?? '—')}</span>
      </div>
      <div class="login__label">ЗАПРОШЕНО (GROSS): ${gross}</div>
      <div class="login__label">НАЛОГ ${rate}: ${tax}</div>
      <div class="login__label">К ВЫДАЧЕ (NET): ${net}</div>
      <div class="login__label">КОММЕНТАРИЙ: ${escapeHtml(withdrawal.comment ?? '—')}</div>
      ${reviewActionsHtml()}
    </article>
  `
}

async function refreshReports(root) {
  const list = root.querySelector('[data-review-reports]')
  try {
    const reports = await getReports()
    const pending = (Array.isArray(reports) ? reports : []).filter((report) => report.status === 'pending')
    list.innerHTML = pending.length
      ? pending.map(reportCardHtml).join('')
      : '<p class="task-empty">НЕТ РАПОРТОВ НА ПРОВЕРКЕ</p>'
  } catch (error) {
    list.innerHTML = '<p class="task-empty">ОШИБКА ЗАГРУЗКИ РАПОРТОВ</p>'
    console.error('refreshReports:', error)
  }
}

async function refreshWithdrawals(root) {
  const list = root.querySelector('[data-review-withdrawals]')
  try {
    const withdrawals = await getWithdrawals()
    const pending = (Array.isArray(withdrawals) ? withdrawals : []).filter((item) => item.status === 'pending')
    list.innerHTML = pending.length
      ? pending.map(withdrawalCardHtml).join('')
      : '<p class="task-empty">НЕТ ЗАПРОСОВ ВЫПЛАТ</p>'
  } catch (error) {
    list.innerHTML = '<p class="task-empty">ОШИБКА ЗАГРУЗКИ ВЫПЛАТ</p>'
    console.error('refreshWithdrawals:', error)
  }
}

async function refreshAll(root) {
  await Promise.all([refreshReports(root), refreshWithdrawals(root)])
}

async function submitReview(root, button) {
  const card = button.closest('[data-review-card]')
  if (!card) return

  const id = card.getAttribute('data-review-id')
  const decision = button.getAttribute('data-review-decision')
  if (!id || (decision !== 'approved' && decision !== 'rejected')) return

  const type = card.getAttribute('data-review-card')
  const comment = card.querySelector('[data-review-comment]')?.value.trim() ?? ''
  const errorElement = root.querySelector(
    type === 'report' ? '[data-reports-error]' : '[data-withdrawals-error]',
  )
  errorElement.hidden = true
  button.disabled = true

  try {
    if (type === 'report') {
      await callRpc('review_report', { p_report_id: id, p_decision: decision, p_comment: comment })
    } else {
      await callRpc('review_withdrawal', { p_id: id, p_decision: decision, p_comment: comment })
    }
    await refreshAll(root)
    notify('Готово', 'success')
  } catch (error) {
    button.disabled = false
    showMessage(errorElement, 'ОШИБКА ПРОВЕРКИ')
    notify('ОШИБКА', 'error')
    console.error('submitReview:', error)
  }
}

export function renderReviews(root) {
  root.innerHTML = `
    <h2 class="task-column__title">РАПОРТЫ НА ПРОВЕРКЕ</h2>
    <div class="task-list" data-review-reports><p class="task-empty">ЗАГРУЗКА...</p></div>
    <p class="login__error" data-reports-error role="alert" hidden></p>

    <h2 class="task-column__title" style="margin-top: 32px;">ЗАПРОСЫ ВЫПЛАТ</h2>
    <div class="task-list" data-review-withdrawals><p class="task-empty">ЗАГРУЗКА...</p></div>
    <p class="login__error" data-withdrawals-error role="alert" hidden></p>
  `

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-review-decision]')
    if (button && root.contains(button)) void submitReview(root, button)
  })

  void refreshAll(root)
}
