import { describe, it, expect } from 'vitest'
import {
  POST_LINES,
  WHISPER_WORDS,
  bootLineText,
  clockStamp,
  consoleReply,
  isTextEntry,
  pickWhisper,
  sessionLabel,
  spawnDelay,
} from '../src/terminal-fx.js'

describe('bootLineText', () => {
  it('returns POST text, not the style modifier', () => {
    expect(bootLineText(0)).toBe('ЭДЕМ BIOS v1.04  ·  1986')
    expect(bootLineText(POST_LINES.length - 1)).toBe('[OK] СИСТЕМА ГОТОВА К РАБОТЕ')
  })
})

describe('sessionLabel', () => {
  it('labels only known roles', () => {
    expect(sessionLabel('curator')).toBe('СЕССИЯ: КУРАТОР')
    expect(sessionLabel('admin')).toBe('СЕССИЯ: ЭДЕМ · ПРАВА: ADMIN')
    expect(sessionLabel('hacker')).toBe('ТЕРМИНАЛ 01 · ПОДКЛЮЧЕНО')
  })
})

describe('spawnDelay', () => {
  it('slows whispers when reduced motion is requested', () => {
    expect(spawnDelay(false, () => 0)).toBe(2600)
    expect(spawnDelay(true, () => 0)).toBe(12000)
  })
})

describe('clockStamp', () => {
  it('pads date and time with leading zeros', () => {
    const date = new Date(2026, 0, 3, 4, 5, 6)
    expect(clockStamp(date)).toBe('03.01.2026 · 04:05:06')
  })
})

describe('consoleReply', () => {
  it('lists available commands for HELP', () => {
    expect(consoleReply('help')).toBe('HELP STATUS TREASURY TASKS WHOAMI DATE CLEAR')
  })

  it('uses live treasury value from the page', () => {
    expect(consoleReply('TREASURY', { treasury: '42 000' })).toContain('42 000')
  })

  it('reports unknown commands with an error prefix', () => {
    expect(consoleReply('BYPASS')).toMatch(/^\[ERR\]/)
  })

  it('returns null for an empty command', () => {
    expect(consoleReply('   ')).toBeNull()
  })
})

describe('isTextEntry', () => {
  it('detects inputs, textareas and editable nodes only', () => {
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('pickWhisper', () => {
  it('returns a word from the curated list', () => {
    expect(WHISPER_WORDS).toContain(pickWhisper(() => 0))
    expect(WHISPER_WORDS).toContain(pickWhisper(() => 0.999999))
  })
})
