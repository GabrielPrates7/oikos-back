// Cálculos PUROS do resumo do Plano do mês (sem I/O): classificação das linhas, totais, linha do
// tempo, semáforo, comparação por categoria e sugestões de corte. Dinheiro sempre em centavos
// inteiros; nenhuma divisão de dinheiro gera float (percentuais em pontos-base inteiros).

import type { PlanItemView } from './plans.types.js'

export type LineSituation = 'pending' | 'received' | 'paid' | 'overdue' | 'estimated'
export type NotCountedReason = 'settled_before_month'

export interface SummaryLine extends PlanItemView {
  situation: LineSituation
  // Valor realizado vindo do lançamento (ou do pagamento da fatura); null se ainda não liquidado.
  realized_amount: number | null
  // realized_amount - planned_amount_cents (null sem realizado).
  delta: number | null
  // Data efetiva de liquidação (D1 = C); null se não liquidado.
  settled_date: string | null
  // false = liquidada ANTES do dia 1: a abertura já reflete esse caixa, então não entra nas somas
  // planejadas nem na projeção (aparece na lista com o motivo).
  counts_in_month: boolean
  not_counted_reason: NotCountedReason | null
}

// ---------------------------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------------------------

export function classifyItem(item: PlanItemView, monthStart: string, today: string): SummaryLine {
  let settledDate: string | null = null
  let realized: number | null = null
  const source = item.source

  if (source?.type === 'income_entry' && source.is_received) {
    settledDate = source.received_date ?? source.entry_date
    realized = source.current_amount_cents
  } else if (source?.type === 'expense' && source.is_paid) {
    settledDate = source.paid_date ?? source.expense_date
    realized = source.current_amount_cents
  } else if (source?.type === 'invoice' && source.paid) {
    settledDate = source.paid.payment_date
    realized = source.paid.amount_cents
  }

  let situation: LineSituation
  if (settledDate !== null) {
    situation = item.kind === 'income' ? 'received' : 'paid'
  } else if (item.source_type === null) {
    situation = 'estimated'
  } else {
    // Atrasada só com data planejada ESTRITAMENTE anterior a hoje (não usa computeDisplayStatus).
    situation = item.planned_date !== null && item.planned_date < today ? 'overdue' : 'pending'
  }

  const countsInMonth = !(settledDate !== null && settledDate < monthStart)
  return {
    ...item,
    situation,
    realized_amount: realized,
    delta: realized === null ? null : realized - item.planned_amount_cents,
    settled_date: settledDate,
    counts_in_month: countsInMonth,
    not_counted_reason: countsInMonth ? null : 'settled_before_month',
  }
}

export function plannedTotals(lines: SummaryLine[]): {
  inflow: number
  outflow: number
  result: number
} {
  let inflow = 0
  let outflow = 0
  for (const line of lines) {
    if (!line.counts_in_month) continue
    if (line.kind === 'income') inflow += line.planned_amount_cents
    else outflow += line.planned_amount_cents
  }
  return { inflow, outflow, result: inflow - outflow }
}

// ---------------------------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------------------------

export interface TimelinePoint {
  date: string
  planned_cents: number
  realized_cents: number | null
}

export interface TimelineResult {
  points: TimelinePoint[]
  min_balance: { date: string; cents: number }
  undated_count: number
}

// Pontos nas datas de evento (linhas que contam), no dia 1, no último dia e em "hoje" (quando o mês
// contém hoje). Planejado = saldo acumulado planejado (abertura só se ligada; senão resultado
// acumulado). Linhas sem data vão para o último dia; data antes do dia 1 vira dia 1. Realizado =
// mesmo acúmulo com os movimentos liquidados, e nulo depois de hoje/da janela.
export function buildTimeline(input: {
  lines: SummaryLine[]
  monthStart: string
  monthEnd: string
  today: string
  windowTo: string
  startBalance: number
  dailyNet: Map<string, number>
}): TimelineResult {
  const { lines, monthStart, monthEnd, today, windowTo, startBalance, dailyNet } = input
  const events = new Map<string, number>()
  let undated = 0
  for (const line of lines) {
    if (!line.counts_in_month) continue
    let date = line.planned_date
    if (date === null) {
      undated += 1
      date = monthEnd
    }
    if (date < monthStart) date = monthStart
    if (date > monthEnd) date = monthEnd
    const signed = line.kind === 'income' ? line.planned_amount_cents : -line.planned_amount_cents
    events.set(date, (events.get(date) ?? 0) + signed)
  }

  const dates = new Set<string>([monthStart, monthEnd, ...events.keys()])
  if (today >= monthStart && today <= monthEnd) dates.add(today)
  const sortedDates = [...dates].sort()
  const realizedDates = [...dailyNet.keys()].sort()

  const points: TimelinePoint[] = []
  let planned = startBalance
  let min = { date: monthStart, cents: startBalance }
  for (const date of sortedDates) {
    planned += events.get(date) ?? 0
    let realized: number | null = null
    if (date >= monthStart && date <= windowTo) {
      realized = startBalance
      for (const day of realizedDates) {
        if (day > date) break
        realized += dailyNet.get(day) ?? 0
      }
    }
    points.push({ date, planned_cents: planned, realized_cents: realized })
    if (planned < min.cents) min = { date, cents: planned }
  }
  return { points, min_balance: min, undated_count: undated }
}

// ---------------------------------------------------------------------------------------------
// Semáforo
// ---------------------------------------------------------------------------------------------

export type HealthLevel = 'red' | 'amber' | 'green' | 'none'
export type HealthReason =
  'EMPTY_PLAN' | 'NO_COUNTED_ITEMS' | 'NEGATIVE_RESULT' | 'LOW_MARGIN' | 'NEGATIVE_MIN_BALANCE'

// red: resultado < 0. amber: resultado >= 0 e (sobra < 10% das entradas planejadas OU menor saldo
// projetado < 0). green: os demais. none: plano sem nenhuma linha (EMPTY_PLAN) ou cujas linhas
// TODAS não contam no mês, por liquidadas antes do dia 1 (NO_COUNTED_ITEMS). Aritmética inteira (sobra*10 <
// entradas): sobra exatamente 10% NÃO é âmbar; sobra 0 com entradas > 0 é âmbar.
export function computeHealth(input: {
  lineCount: number
  countedCount: number
  inflow: number
  result: number
  minBalanceCents: number
}): { level: HealthLevel; reasons: HealthReason[] } {
  if (input.lineCount === 0) return { level: 'none', reasons: ['EMPTY_PLAN'] }
  if (input.countedCount === 0) return { level: 'none', reasons: ['NO_COUNTED_ITEMS'] }
  const reasons: HealthReason[] = []
  if (input.result < 0) reasons.push('NEGATIVE_RESULT')
  else if (input.result * 10 < input.inflow) reasons.push('LOW_MARGIN')
  if (input.minBalanceCents < 0) reasons.push('NEGATIVE_MIN_BALANCE')
  if (input.result < 0) return { level: 'red', reasons }
  return { level: reasons.length > 0 ? 'amber' : 'green', reasons }
}

// ---------------------------------------------------------------------------------------------
// Comparação por categoria (competência)
// ---------------------------------------------------------------------------------------------

export type CategoryStatus = 'no_plan' | 'ok' | 'attention' | 'over' | 'unplanned'

// % inteiro IDÊNTICO ao de Orçamentos (budgets.service: Math.round(gasto / limite * 100)). É um
// percentual, não dinheiro, e usa de propósito a MESMA expressão em ponto flutuante: nos meios
// exatos (ex.: 100,5%) o erro de ponto flutuante faz Orçamentos arredondar para 100, e o Plano
// precisa concordar com ele. Limiares iguais: > 100 excedido, >= 70 atenção.
export function percentUsed(realized: number, planned: number): number | null {
  if (planned <= 0) return null
  return Math.round((realized / planned) * 100)
}

export function categoryStatus(planned: number, realized: number): CategoryStatus {
  if (planned <= 0) return realized > 0 ? 'unplanned' : 'no_plan'
  const percent = percentUsed(realized, planned) as number
  if (percent > 100) return 'over'
  if (percent >= 70) return 'attention'
  return 'ok'
}

export interface CategoryRow {
  category_id: string
  name: string
  icon: string | null
  planned: number
  realized: number
  variance: number
  percent_used: number | null
  status: CategoryStatus
  // Alguma fatura incluída tem reference_month diferente do mês do plano: o realizado de
  // Orçamentos atribui as parcelas por reference_month (ressalva R1).
  invoice_month_mismatch: boolean
}

export function buildByCategory(
  planned: Map<string, { name: string; icon: string | null; cents: number; mismatch: boolean }>,
  spent: { category_id: string; name: string; icon: string | null; total: number }[],
): CategoryRow[] {
  const rows = new Map<string, CategoryRow>()
  const ensure = (id: string, name: string, icon: string | null): CategoryRow => {
    let row = rows.get(id)
    if (!row) {
      row = {
        category_id: id,
        name,
        icon,
        planned: 0,
        realized: 0,
        variance: 0,
        percent_used: null,
        status: 'no_plan',
        invoice_month_mismatch: false,
      }
      rows.set(id, row)
    }
    return row
  }
  for (const [id, value] of planned) {
    const row = ensure(id, value.name, value.icon)
    row.planned += value.cents
    row.invoice_month_mismatch = row.invoice_month_mismatch || value.mismatch
  }
  for (const item of spent) ensure(item.category_id, item.name, item.icon).realized += item.total
  for (const row of rows.values()) {
    row.variance = row.realized - row.planned
    row.percent_used = percentUsed(row.realized, row.planned)
    row.status = categoryStatus(row.planned, row.realized)
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.realized - a.realized ||
      b.planned - a.planned ||
      a.name.localeCompare(b.name, 'pt-BR') ||
      a.category_id.localeCompare(b.category_id),
  )
}

// ---------------------------------------------------------------------------------------------
// Onde cortar
// ---------------------------------------------------------------------------------------------

export interface CutSuggestions {
  // Total planejado das linhas de despesa supérfluas (is_essential = false) que contam no mês.
  total_cents: number
  // Parte ainda cortável (não liquidada: pendente, atrasada ou estimada).
  cuttable_cents: number
  top: {
    id: string
    description: string
    planned_amount_cents: number
    situation: LineSituation
    planned_date: string | null
  }[]
  // Quanto do buraco a parte cortável cobre, em pontos-base (10000 = 100%); null sem buraco.
  covers_gap_to_zero_bps: number | null
  covers_gap_to_cash_zero_bps: number | null
}

export function buildCutSuggestions(
  lines: SummaryLine[],
  gapToZero: number,
  gapToCashZero: number,
): CutSuggestions {
  const superfluous = lines.filter(
    (line) => line.counts_in_month && line.kind === 'expense' && line.is_essential === false,
  )
  const total = superfluous.reduce((sum, line) => sum + line.planned_amount_cents, 0)
  const cuttable = superfluous
    .filter((line) => line.situation !== 'paid')
    .reduce((sum, line) => sum + line.planned_amount_cents, 0)
  const top = [...superfluous]
    .sort(
      (a, b) =>
        b.planned_amount_cents - a.planned_amount_cents ||
        a.description.localeCompare(b.description, 'pt-BR') ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 5)
    .map((line) => ({
      id: line.id,
      description: line.description,
      planned_amount_cents: line.planned_amount_cents,
      situation: line.situation,
      planned_date: line.planned_date,
    }))
  const covers = (gap: number) => (gap > 0 ? Math.round((cuttable * 10000) / gap) : null)
  return {
    total_cents: total,
    cuttable_cents: cuttable,
    top,
    covers_gap_to_zero_bps: covers(gapToZero),
    covers_gap_to_cash_zero_bps: covers(gapToCashZero),
  }
}

// Progresso em pontos-base inteiros (10000 = 100%); denominador 0 -> 0. Pode passar de 10000.
export function progressBps(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator * 10000) / denominator)
}
