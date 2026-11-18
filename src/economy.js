export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function sumShifts(shifts) {
  return shifts.reduce((total, shift) => total + shift, 0)
}

export function resolveTaxRate({ baseTax, shifts, minTax, maxTax }) {
  return clamp(baseTax + sumShifts(shifts), minTax, maxTax)
}

export function taxedAmount(gross, taxRate) {
  const taxAmount = Math.round(gross * taxRate / 100)
  return { taxAmount, net: gross - taxAmount }
}

export function dailyPayout({ basePayout, baseTax, minTax, maxTax, bonusPercents = [], shifts = [] }) {
  let gross = basePayout
  for (const percent of bonusPercents) {
    gross += Math.round(basePayout * percent / 100)
  }

  const taxRate = resolveTaxRate({ baseTax, shifts, minTax, maxTax })
  return { gross, taxRate, ...taxedAmount(gross, taxRate) }
}

export function reportTariff({ interactionType, tariffs, linkedToTask }) {
  const tariff = tariffs[interactionType]
  return linkedToTask ? Math.round(tariff * 0.2) : tariff
}

export function withdrawal({ amountGross, taxRate }) {
  return taxedAmount(amountGross, taxRate)
}

export function applyCap({ balance, incoming, cap }) {
  const room = Math.max(0, cap - balance)
  const credited = Math.min(incoming, room)
  return { balance: balance + credited, credited, burned: incoming - credited }
}
