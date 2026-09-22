// Datas do Plano do mês. Tudo string 'YYYY-MM-DD' / 'YYYY-MM' (nunca Date com fuso); Date só entra como
// calculadora de calendário em UTC (Date.UTC + getUTC*), então o fuso do processo não interfere.

const SAO_PAULO_TZ = 'America/Sao_Paulo'

const saoPauloDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAO_PAULO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// "Hoje" no fuso America/Sao_Paulo, independente do fuso do processo. É deliberadamente um helper
// próprio do Plano: o resto do backend (Dashboard, faturas) usa o relógio local do processo.
export function todayInSaoPaulo(now: Date = new Date()): string {
  return saoPauloDateFormat.format(now)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthBounds(month: string): { monthStart: string; monthEnd: string } {
  const [year, monthNum] = month.split('-').map(Number)
  return {
    monthStart: `${month}-01`,
    monthEnd: `${month}-${pad2(daysInMonth(year, monthNum))}`,
  }
}

export function previousMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  return monthNum === 1 ? `${year - 1}-12` : `${year}-${pad2(monthNum - 1)}`
}

// +1 mês mantendo o dia, limitado ao último dia do mês de destino (31/jan -> 28 ou 29/fev).
export function shiftDateOneMonthClamped(isoDate: string): string {
  const [year, monthNum, day] = isoDate.split('-').map(Number)
  const targetYear = monthNum === 12 ? year + 1 : year
  const targetMonth = monthNum === 12 ? 1 : monthNum + 1
  return `${targetYear}-${pad2(targetMonth)}-${pad2(Math.min(day, daysInMonth(targetYear, targetMonth)))}`
}

export function isDateInMonth(isoDate: string, month: string): boolean {
  const { monthStart, monthEnd } = monthBounds(month)
  return isoDate >= monthStart && isoDate <= monthEnd
}

// Soma (ou subtrai) dias de uma data 'YYYY-MM-DD' em calendário UTC (sem fuso).
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}
