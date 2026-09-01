// Funções puras da regra de atribuição de fatura (seção 5.4 do documento técnico).
// Sem I/O, sem dependência de banco — testáveis isoladamente.
// Datas trafegam como string 'YYYY-MM-DD', nunca como Date com timezone (princípio #4).

interface CalendarDate {
  year: number
  month: number // 1-indexed
  day: number
}

function parseDate(dateStr: string): CalendarDate {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

// new Date(year, month, 0) usa month 0-indexed; passar o mês 1-indexed alvo faz o
// dia 0 "rolar pra trás" até o último dia do mês anterior a esse índice, ou seja,
// o último dia do mês 1-indexed `month`. Só usamos Date como calculadora de calendário
// local — nunca lemos de volta via toISOString()/UTC, então não há bug de fuso.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function addOneMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) {
    return { year: year + 1, month: 1 }
  }
  return { year, month: month + 1 }
}

/**
 * Resolve o reference_month (primeiro dia do mês) da PARCELA 1 de uma compra,
 * conforme a regra da seção 5.4:
 * SE dia(purchase_date) <= closing_day ENTÃO mês da compra, SENÃO mês seguinte.
 */
export function resolveInitialReferenceMonth(purchaseDate: string, closingDay: number): string {
  const { year, month, day } = parseDate(purchaseDate)

  if (day <= closingDay) {
    return formatDate(year, month, 1)
  }

  const next = addOneMonth(year, month)
  return formatDate(next.year, next.month, 1)
}

/**
 * Soma N meses a um reference_month (primeiro dia do mês), tratando virada de ano.
 */
export function addMonthsToReferenceMonth(referenceMonth: string, months: number): string {
  const { year, month } = parseDate(referenceMonth)

  const totalMonths = month - 1 + months
  const newYear = year + Math.floor(totalMonths / 12)
  const newMonth = (((totalMonths % 12) + 12) % 12) + 1

  return formatDate(newYear, newMonth, 1)
}

/**
 * Calcula closing_date e due_date de uma fatura a partir do reference_month.
 * due_date cai no mesmo mês do closing_date se due_day > closing_day; senão, mês seguinte.
 * Dias inexistentes no mês (ex: 31 em fevereiro) são clampados pro último dia real do mês.
 */
export function computeInvoiceDates(
  referenceMonth: string,
  closingDay: number,
  dueDay: number,
): { closingDate: string; dueDate: string } {
  const { year, month } = parseDate(referenceMonth)

  const closingDayClamped = Math.min(closingDay, daysInMonth(year, month))
  const closingDate = formatDate(year, month, closingDayClamped)

  let dueYear = year
  let dueMonth = month
  if (dueDay <= closingDay) {
    const next = addOneMonth(year, month)
    dueYear = next.year
    dueMonth = next.month
  }
  const dueDayClamped = Math.min(dueDay, daysInMonth(dueYear, dueMonth))
  const dueDate = formatDate(dueYear, dueMonth, dueDayClamped)

  return { closingDate, dueDate }
}

/**
 * Divide um valor total em N parcelas inteiras (centavos). As primeiras N-1 recebem
 * floor(total/N); a última recebe o restante, garantindo soma exata mesmo em divisão
 * não exata (ex: 1000 em 3x = 333, 333, 334).
 */
export function splitInstallmentAmounts(
  totalAmountCents: number,
  installmentsCount: number,
): number[] {
  const base = Math.floor(totalAmountCents / installmentsCount)
  const amounts = new Array(installmentsCount).fill(base)
  const remainder = totalAmountCents - base * installmentsCount
  amounts[installmentsCount - 1] += remainder
  return amounts
}
