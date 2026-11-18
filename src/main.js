import { getRole } from './auth.js'
import { renderLogin } from './pages/login.js'
import { renderHome } from './pages/home.js'
import { renderReports } from './pages/reports.js'
import { renderHistory } from './pages/history.js'

const root = document.getElementById('app')
const DEFAULT_ROUTE = '#/home'
const routes = {
  [DEFAULT_ROUTE]: renderHome,
  '#/reports': renderReports,
  '#/history': renderHistory,
}

async function render() {
  const role = await getRole()
  if (!role) {
    renderLogin(root)
    return
  }
  const renderPage = routes[location.hash] ?? routes[DEFAULT_ROUTE]
  await renderPage(root)
}

window.addEventListener('hashchange', render)
render()
