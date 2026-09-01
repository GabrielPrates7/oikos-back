// Mesmo truque de calendário local usado em purchases/invoice-assignment.util.ts:
// new Date(year, month, 0) com month 1-indexed rola pro último dia do mês alvo.
// Nunca lemos de volta via toISOString()/UTC, então não há bug de fuso.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function currentMonthString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Primeiro e último dia (strings 'YYYY-MM-DD') de um mês no formato 'YYYY-MM'.
 */
export function monthRange(month: string): { monthStart: string; monthEnd: string } {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr)

  const monthStart = `${yearStr}-${monthStr}-01`
  const monthEnd = `${yearStr}-${monthStr}-${String(daysInMonth(year, monthNum)).padStart(2, '0')}`

  return { monthStart, monthEnd }
}
