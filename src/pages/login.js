import { signIn } from '../auth.js'

export function renderLogin(root) {
  root.innerHTML = `
    <section class="login">
      <h1 class="login__title">ВХОД В СИСТЕМУ</h1>
      <div class="login__tabs" role="tablist" aria-label="Роль">
        <button type="button" class="tab tab--active" data-role="curator" role="tab" aria-selected="true">Куратор</button>
        <button type="button" class="tab" data-role="admin" role="tab" aria-selected="false">ЭDEM</button>
      </div>
      <form class="login__form">
        <label class="login__label" for="login-password">ПАРОЛЬ</label>
        <input class="input" id="login-password" type="password" autocomplete="current-password" required>
        <button class="btn" type="submit">Войти</button>
        <p class="login__error" role="alert" hidden>Неверный пароль</p>
      </form>
    </section>
  `

  const tabs = Array.from(root.querySelectorAll('.tab'))
  const form = root.querySelector('.login__form')
  const input = root.querySelector('#login-password')
  const error = root.querySelector('.login__error')
  let role = 'curator'

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      role = tab.dataset.role
      tabs.forEach((other) => {
        const active = other === tab
        other.classList.toggle('tab--active', active)
        other.setAttribute('aria-selected', String(active))
      })
      error.hidden = true
      input.focus()
    })
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    error.hidden = true
    try {
      await signIn(role, input.value)
      if (location.hash === '#/home') {
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      } else {
        location.hash = '#/home'
      }
    } catch {
      error.hidden = false
      input.focus()
      input.select()
    }
  })

  input.focus()
}
