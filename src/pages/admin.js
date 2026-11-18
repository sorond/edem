import { getRole } from '../auth.js'
import { getSettings } from '../api.js'
import { mountSettings } from '../admin/settings.js'
import { mountTreasury } from '../admin/treasury.js'
import { mountTasks } from '../admin/tasks.js'
import { mountEvents } from '../admin/events.js'

export async function renderAdmin(root) {
  const role = await getRole()
  if (role !== 'admin') {
    root.innerHTML = '<p class="placeholder">ПЕРЕНАПРАВЛЕНИЕ...</p>'
    location.hash = '#/home'
    return
  }

  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'
  let settings
  try {
    settings = await getSettings()
  } catch (error) {
    root.innerHTML = '<p class="placeholder" role="alert">ОШИБКА ЗАГРУЗКИ НАСТРОЕК</p>'
    console.error('renderAdmin:', error)
    return
  }

  root.innerHTML = `
    <section class="admin">
      <h1 class="login__title">АДМИНКА</h1>
      <h2 class="task-column__title">НАСТРОЙКИ</h2>
      <div data-admin-settings></div>
      <h2 class="task-column__title">КАЗНА</h2>
      <div data-admin-treasury></div>
      <h2 class="task-column__title">ЗАДАНИЯ</h2>
      <div data-admin-tasks></div>
      <h2 class="task-column__title">СОБЫТИЯ</h2>
      <div data-admin-events></div>
    </section>
  `

  mountSettings(root.querySelector('[data-admin-settings]'), settings)
  mountTreasury(root.querySelector('[data-admin-treasury]'))
  mountTasks(root.querySelector('[data-admin-tasks]'))
  mountEvents(root.querySelector('[data-admin-events]'))
}
