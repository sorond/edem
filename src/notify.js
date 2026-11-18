const CLASS_BY_KIND = {
  success: 'toast toast--success',
  error: 'toast toast--error',
  warning: 'toast toast--warning',
}

export function notify(message, kind = 'success') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = CLASS_BY_KIND[kind] ?? CLASS_BY_KIND.success
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 4000)
}

// Короткий прямоугольный сигнал 880 Гц. Браузер может запретить аудио без
// действия пользователя — в этом случае уведомление остаётся только визуальным.
export function playBeep() {
  try {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime

    oscillator.type = 'square'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => void context.close?.()?.catch?.(() => {})
    oscillator.start(now)
    oscillator.stop(now + 0.15)
    void context.resume?.()?.catch?.(() => {})
  } catch {
    // AudioContext недоступен или заблокирован — тихо продолжаем.
  }
}
