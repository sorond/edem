import { getRole } from './auth.js'
import { renderLogin } from './pages/login.js'

const root = document.getElementById('app')

async function render() {
  const role = await getRole()
  if (!role) {
    renderLogin(root)
    return
  }
  // Minimal shell: page modules are wired in by later tasks.
  root.innerHTML = '<p class="placeholder">ЗАГРУЗКА...</p>'
}

window.addEventListener('hashchange', render)
render()
