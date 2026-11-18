import { describe, it, expect } from 'vitest'
import {
  resolveTaxRate, dailyPayout, taxedAmount,
  reportTariff, withdrawal, applyCap
} from '../src/economy.js'

describe('resolveTaxRate', () => {
  it('clamps tax between min and max', () => {
    expect(resolveTaxRate({ baseTax: 30, shifts: [-50], minTax: 10, maxTax: 80 })).toBe(10)
    expect(resolveTaxRate({ baseTax: 30, shifts: [100], minTax: 10, maxTax: 80 })).toBe(80)
  })
})

describe('dailyPayout', () => {
  it('counts base payout without bonuses', () => {
    expect(dailyPayout({ basePayout: 60000, baseTax: 30, minTax: 10, maxTax: 80 }))
      .toEqual({ gross: 60000, taxRate: 30, taxAmount: 18000, net: 42000 })
  })

  it('stacks weekly bonus and tax shifts', () => {
    expect(dailyPayout({
      basePayout: 60000,
      baseTax: 30,
      minTax: 10,
      maxTax: 80,
      bonusPercents: [10],
      shifts: [-5, 10]
    })).toEqual({ gross: 66000, taxRate: 35, taxAmount: 23100, net: 42900 })
  })
})

describe('taxedAmount', () => {
  it('taxes urgent task reward', () => {
    expect(taxedAmount(100000, 35)).toEqual({ taxAmount: 35000, net: 65000 })
  })
})

describe('reportTariff', () => {
  it('uses full tariff for report without task', () => {
    const tariffs = { external: 10000, internal: 5000 }
    expect(reportTariff({ interactionType: 'external', tariffs, linkedToTask: false })).toBe(10000)
    expect(reportTariff({ interactionType: 'internal', tariffs, linkedToTask: false })).toBe(5000)
  })

  it('uses 20 percent for report with task', () => {
    const tariffs = { external: 10000, internal: 5000 }
    expect(reportTariff({ interactionType: 'external', tariffs, linkedToTask: true })).toBe(2000)
    expect(reportTariff({ interactionType: 'internal', tariffs, linkedToTask: true })).toBe(1000)
  })
})

describe('withdrawal', () => {
  it('burns tax from requested gross', () => {
    expect(withdrawal({ amountGross: 60000, taxRate: 30 }))
      .toEqual({ taxAmount: 18000, net: 42000 })
  })
})

describe('applyCap', () => {
  it('burns excess above treasury cap', () => {
    expect(applyCap({ balance: 120000, incoming: 42900, cap: 126000 }))
      .toEqual({ balance: 126000, credited: 6000, burned: 36900 })
  })
})
