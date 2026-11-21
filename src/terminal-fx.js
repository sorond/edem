export const ROLE_KEY = 'edem_role'
export const COMMANDS = ['HELP', 'STATUS', 'TREASURY', 'TASKS', 'WHOAMI', 'DATE', 'CLEAR']

export const POST_LINES = [
  { text: 'ЭДЕМ BIOS v1.04  ·  1986', modifier: 'dim' },
  { text: 'ПРОВЕРКА ПАМЯТИ ......... 640K OK', modifier: '' },
  { text: 'ПОРТ УЗЛА 01 ............ ПОДКЛЮЧЕНО', modifier: '' },
  { text: 'ТАБЛИЦА РОЛЕЙ ........... OK', modifier: '' },
  { text: 'СИНХРОНИЗАЦИЯ КАЗНЫ ..... OK', modifier: '' },
  { text: '[OK] СИСТЕМА ГОТОВА К РАБОТЕ', modifier: 'inv' },
]

export const WHISPER_WORDS = [
  'ШЕПОТ', 'МАГНИТ', 'ОТКЛИК', 'ПЕПЕЛ', 'СИГНАЛ', 'ТРЕЩИНА', 'ЭХО', 'ПУЛЬС',
  'НИТЬ', 'СЛЕД', 'ПОВТОР', 'ГРАНЬ', 'ШУМ', 'ДЫМ', 'ПАУЗА', 'ОСТАТОК',
  'СМЕЩЕНИЕ', 'СТАЗИС', 'ЗДЕСЬ', 'НАБЛЮДАЮ', 'ПОЗДНО', 'НЕ ТО', 'МОЛЧИ',
  'СЛЫШУ', 'ОПЯТЬ', 'ТИШИНА', 'ИСКРА', 'ХОЛОД', 'ПУСТО', 'ОН СМОТРИТ',
  'НЕ ВЫХОДИ', 'Я ЗДЕСЬ', 'ВСЁ СЛЫШНО', 'ПОСЛЕДНИЙ СЕАНС', 'НЕ НАЖИМАЙ',
  'КТО-ТО ДЫШИТ', 'ПОТЕРЯН СЧЁТ', 'ОТВЕТА НЕТ', 'СЛИШКОМ ТИХО',
  'ЭТО НЕ СОН', 'СЛОВА ЛГУТ', 'ОНИ СЧИТАЮТ',
]

export function clockStamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function isTextEntry(element) {
  if (!element) return false
  return element.tagName === 'INPUT'
    || element.tagName === 'TEXTAREA'
    || element.tagName === 'SELECT'
    || element.isContentEditable === true
}

export function pickWhisper(random = Math.random) {
  return WHISPER_WORDS[Math.floor(random() * WHISPER_WORDS.length)]
}

export function bootLineText(index) {
  return POST_LINES[index]?.text ?? ''
}

export function sessionLabel(role) {
  if (role === 'admin') return 'СЕССИЯ: ЭДЕМ · ПРАВА: ADMIN'
  if (role === 'curator') return 'СЕССИЯ: КУРАТОР'
  return 'ТЕРМИНАЛ 01 · ПОДКЛЮЧЕНО'
}

export function spawnDelay(reduce, random = Math.random) {
  return reduce ? 12000 + random() * 8000 : 2600 + random() * 4200
}

export function consoleReply(command, state = {}) {
  const cmd = String(command).trim().toUpperCase()
  switch (cmd) {
    case 'HELP':
      return COMMANDS.join(' ')
    case 'STATUS':
      return `УЗЕЛ 01 · СВЯЗЬ: СТАБИЛЬНА · СЕССИЯ: ${state.role ?? '—'}`
    case 'TREASURY':
      return `КАЗНА: ${state.treasury ?? '—'}`
    case 'TASKS':
      return `АКТИВНЫХ: ${state.weekly ?? 0} · СРОЧНЫХ: ${state.urgent ?? 0} · НА ПРОВЕРКЕ: ${state.reviews ?? 0}`
    case 'WHOAMI':
      return `${state.role ?? '—'} · ПРАВА: ${state.role === 'admin' ? 'ADMIN' : 'READ/WRITE'}`
    case 'DATE':
      return state.stamp ?? clockStamp(new Date())
    case 'CLEAR':
      return ''
    case '':
      return null
    default:
      return '[ERR] НЕИЗВЕСТНАЯ КОМАНДА · HELP'
  }
}

function readRole() {
  try {
    return localStorage.getItem(ROLE_KEY)
  } catch {
    return null
  }
}

function currentState() {
  const tasks = Array.from(document.querySelectorAll('.task-columns .task'))
  const adminRows = Array.from(document.querySelectorAll('[data-archive-task]'))
    .map((button) => button.closest('tr'))
  const adminUrgent = adminRows.filter(
    (row) => row?.children[1]?.textContent.trim() === 'СРОЧНОЕ',
  ).length
  return {
    role: readRole(),
    treasury: document.querySelector('.treasury__amount')?.textContent.trim()
      || document.querySelector('[data-treasury-balance]')?.textContent.trim()
      || '—',
    weekly: tasks.filter((task) => !task.classList.contains('urgent')).length
      || adminRows.length - adminUrgent,
    urgent: tasks.filter((task) => task.classList.contains('urgent')).length || adminUrgent,
    reviews: document.querySelectorAll('[data-review-card]').length,
    stamp: clockStamp(new Date()),
  }
}

if (typeof document !== 'undefined') {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const boot = document.getElementById('boot')
  const bootLog = document.getElementById('boot-log')
  if (boot && bootLog) {
    let index = 0
    let char = 0
    let finished = false
    let timer = null

    const makeLine = ({ text, modifier }) => {
      const node = document.createElement('div')
      node.className = `boot__line${modifier ? ` ${modifier}` : ''}`
      node.textContent = text
      return node
    }
    let line = makeLine(POST_LINES[0])
    bootLog.append(line)

    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      bootLog.replaceChildren(...POST_LINES.map(makeLine))
      boot.classList.add('out')
      setTimeout(() => boot.remove(), reduce ? 0 : 360)
    }

    const step = () => {
      if (finished) return
      const text = bootLineText(index)
      if (char < text.length) {
        line.textContent = text.slice(0, ++char)
        timer = setTimeout(step, reduce ? 0 : 9)
        return
      }
      char = 0
      index += 1
      if (index < POST_LINES.length) {
        line = makeLine(POST_LINES[index])
        bootLog.append(line)
        timer = setTimeout(step, reduce ? 0 : 90)
      } else {
        finish()
      }
    }

    timer = setTimeout(step, 180)
    boot.addEventListener('click', finish)
    window.addEventListener('keydown', finish, { once: true })
  }

  const clocks = document.querySelectorAll('[data-clock]')
  const session = document.querySelector('[data-session]')
  const tick = () => {
    const stamp = clockStamp(new Date())
    clocks.forEach((node) => { node.textContent = stamp })
    if (session) session.textContent = sessionLabel(readRole())
  }
  tick()
  setInterval(tick, 1000)

  const consoleBox = document.getElementById('terminal-console')
  const consoleToggle = document.getElementById('console-toggle')
  const consoleInput = document.getElementById('console-input')
  const consoleLog = document.getElementById('console-log')
  if (consoleBox && consoleToggle && consoleInput && consoleLog) {
    const write = (text, strong = false) => {
      const row = document.createElement('div')
      if (strong) {
        const bold = document.createElement('b')
        bold.textContent = text
        row.append(bold)
      } else {
        row.textContent = text
      }
      consoleLog.append(row)
      consoleLog.scrollTop = consoleLog.scrollHeight
    }
    const setOpen = (open) => {
      consoleBox.hidden = !open
      consoleToggle.setAttribute('aria-expanded', String(open))
      consoleToggle.textContent = open ? '[X] ЗАКРЫТЬ' : '[>_ КОНСОЛЬ]'
      if (open) consoleInput.focus()
      else consoleToggle.focus()
    }
    consoleToggle.addEventListener('click', () => setOpen(consoleBox.hidden))
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey
        && !isTextEntry(document.activeElement)) {
        event.preventDefault()
        setOpen(true)
      } else if (event.key === 'Escape' && !consoleBox.hidden) {
        setOpen(false)
      }
    })
    consoleInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      const command = consoleInput.value.trim().toUpperCase()
      consoleInput.value = ''
      if (!command) return
      write(`> ${command}`, true)
      if (command === 'CLEAR') {
        consoleLog.replaceChildren()
        return
      }
      const reply = consoleReply(command, currentState())
      if (reply !== null) write(reply, command === 'HELP' || command === 'DATE' || reply.startsWith('[ERR]'))
    })
  }

  const app = document.getElementById('app')
  if (app) {
    const spawn = () => {
      if (readRole() !== 'curator') return
      const word = document.createElement('span')
      word.className = 'whisper'
      word.textContent = pickWhisper()
      const opacity = 0.3 + Math.random() * 0.45
      word.style.setProperty('--o', opacity.toFixed(2))
      word.style.opacity = opacity.toFixed(2)
      word.style.fontSize = `${14 + Math.floor(Math.random() * 20)}px`
      word.style.left = `${6 + Math.random() * 78}%`
      word.style.top = `${8 + Math.random() * 76}%`
      word.style.transform = `rotate(${(Math.random() * 24 - 12).toFixed(1)}deg)`
      word.style.animationDuration = `${(3.5 + Math.random() * 3).toFixed(1)}s`
      app.append(word)
      setTimeout(() => word.remove(), 7200)
    }
    const loop = () => {
      spawn()
      setTimeout(loop, spawnDelay(reduce))
    }
    setTimeout(loop, reduce ? 12000 : 1600)
  }
}
