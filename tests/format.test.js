import { describe, it, expect } from 'vitest'
import { formatMoney, formatPercent } from '../src/format.js'

describe('formatMoney', () => {
  it('groups thousands with spaces', () => {
    expect(formatMoney(107900)).toBe('107 900')
    expect(formatMoney(0)).toBe('0')
  })
})

describe('formatPercent', () => {
  it('adds percent sign', () => {
    expect(formatPercent(35)).toBe('35%')
    expect(formatPercent(10.5)).toBe('10.5%')
  })
})
