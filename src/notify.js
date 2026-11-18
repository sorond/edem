const CLASS_BY_KIND = {
  success: 'toast toast--success',
  error: 'toast toast--error',
}

export function notify(message, kind = 'success') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const isError = kind === 'error'
  const toast = document.createElement('div')
  toast.className = CLASS_BY_KIND[kind] ?? CLASS_BY_KIND.success
  toast.textContent = message
  Object.assign(toast.style, {
    padding: '10px 14px',
    border: `1px solid ${isError ? 'var(--error)' : 'var(--border)'}`,
    background: 'rgba(5, 11, 5, 0.95)',
    color: isError ? 'var(--error)' : 'var(--fg)',
    textShadow: `0 0 6px ${isError ? 'var(--error)' : 'var(--fg)'}`,
    letterSpacing: '0.15em',
  })

  container.appendChild(toast)
  setTimeout(() => toast.remove(), 4000)
}
