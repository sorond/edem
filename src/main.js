import { getRole } from './auth.js'
import { renderLogin } from './pages/login.js'
import { renderHome } from './pages/home.js'
import { renderReports } from './pages/reports.js'
import { renderHistory } from './pages/history.js'
import { renderAdmin } from './pages/admin.js'

const root = document.getElementById('app')
const nav = document.querySelector('[data-nav]')
const navLinks = document.querySelectorAll('[data-route]')
const adminLink = document.querySelector('[data-admin-link]')
const DEFAULT_ROUTE = '#/home'
const routes = {
  [DEFAULT_ROUTE]: renderHome,
  '#/reports': renderReports,
  '#/history': renderHistory,
  '#/admin': renderAdmin,
}

function updateNav(role) {
  const hash = Object.hasOwn(routes, location.hash) ? location.hash : DEFAULT_ROUTE
  if (nav) nav.hidden = !role
  if (adminLink) adminLink.hidden = role !== 'admin'

  for (const link of navLinks) {
    const isActive = link.dataset.route === hash
    link.classList.toggle('nav__link--active', isActive)
    if (isActive) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

async function render() {
  const role = await getRole()
  updateNav(role)
  if (!role) {
    renderLogin(root)
    return
  }
  const renderPage = routes[location.hash] ?? routes[DEFAULT_ROUTE]
  await renderPage(root)
}

window.addEventListener('hashchange', render)
render()
