import type { PoolClient } from 'pg'
import { pool } from '../../config/database.js'
import { AppError, NotFoundError } from '../../errors/AppError.js'
import { categoriesRepository } from '../categories/categories.repository.js'
import {
  addDays,
  isDateInMonth,
  monthBounds,
  previousMonth,
  shiftDateOneMonthClamped,
  todayInSaoPaulo,
} from './plans.date.js'
import { plansRepository, type OwnedSource } from './plans.repository.js'
import {
  buildByCategory,
  buildCutSuggestions,
  buildTimeline,
  classifyItem,
  computeHealth,
  plannedTotals,
  progressBps,
} from './plans.summary.js'
import type {
  CandidatesQuery,
  CreateManualItemInput,
  ImportInput,
  LinkItemsInput,
  UpdateItemInput,
} from './plans.schema.js'
import type {
  CandidateView,
  ImportResult,
  ImportSettledCounts,
  LinkIgnoredReason,
  LinkResult,
  MonthlyPlan,
  PlanItemView,
  PlanKind,
  PlanSettingsView,
  PlanSourceType,
} from './plans.types.js'

// Deadlock (40P01) e falha de serialização (40001) são transitórios: a transação inteira é repetida.
const RETRYABLE_PG_CODES = new Set(['40P01', '40001'])
const MAX_ATTEMPTS = 4

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      const code = (error as { code?: string }).code
      if (attempt < MAX_ATTEMPTS && code && RETRYABLE_PG_CODES.has(code)) continue
      throw error
    } finally {
      client.release()
    }
  }
}

function settingsView(plan: MonthlyPlan | null, month: string): PlanSettingsView {
  return {
    id: plan?.id ?? null,
    month,
    include_opening_balance: plan?.include_opening_balance ?? true,
  }
}

// Categoria visível ao usuário (própria ou padrão) e do tipo coerente com a linha.
async function assertCategoryForKind(
  categoryId: string,
  userId: string,
  kind: PlanKind,
): Promise<void> {
  const category = await categoriesRepository.findByIdVisibleToUser(categoryId, userId)
  if (!category) {
    throw new NotFoundError('categoria não encontrada')
  }
  if (category.type !== kind) {
    throw new AppError(400, `categoria inválida: precisa ser do tipo ${kind}`)
  }
}

function assertDateInMonth(date: string, month: string): void {
  if (!isDateInMonth(date, month)) {
    throw new AppError(400, 'planned_date deve estar dentro do mês do plano')
  }
}

// Mesma regra dos candidatos e da importação (repository.lancamentoPeriodSql / invoicePeriodSql):
// data no mês; OU já liquidado com data efetiva de liquidação no mês (fatura: payment_date);
// OU (só lançamento) pendente atrasado de antes do mês, com comparação estrita com hoje.
function isInCandidatePeriod(
  source: OwnedSource,
  monthStart: string,
  monthEnd: string,
  today: string,
): boolean {
  const inMonth = (date: string) => date >= monthStart && date <= monthEnd
  if (inMonth(source.date)) return true
  if (source.settled && source.settled_date && inMonth(source.settled_date)) return true
  if (source.type === 'invoice') return false
  return !source.settled && source.date < monthStart && source.date < today
}

const EDITABLE_MANUAL = [
  'description',
  'category_id',
  'planned_amount_cents',
  'planned_date',
  'is_essential',
] as const
const EDITABLE_LINKED = ['planned_amount_cents', 'planned_date'] as const
const EDITABLE_INVOICE = ['planned_date'] as const

function dedupeKey(kind: PlanKind, description: string, categoryId: string | null, amount: number) {
  return `${kind}|${description}|${categoryId ?? ''}|${amount}`
}

function truncateDescription(description: string): string {
  return Array.from(description).slice(0, 200).join('')
}

// Leitura consistente: todas as consultas do resumo enxergam o MESMO retrato do banco (REPEATABLE
// READ, somente leitura), então a identidade de reconciliação não é quebrada por uma escrita no meio.
async function withReadSnapshot<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const plansService = {
  async getMonth(userId: string, month: string) {
    const { monthStart } = monthBounds(month)
    const plan = await plansRepository.findPlan(userId, monthStart)
    const items = plan ? await plansRepository.listItems(plan.id, userId) : []
    return { month, plan: settingsView(plan, month), items }
  },

  async updateSettings(userId: string, month: string, includeOpeningBalance: boolean) {
    const { monthStart } = monthBounds(month)
    const plan = await plansRepository.upsertPlan(userId, monthStart, includeOpeningBalance)
    return settingsView(plan, month)
  },

  async createManualItem(
    userId: string,
    month: string,
    data: CreateManualItemInput,
  ): Promise<PlanItemView> {
    if (data.planned_date) assertDateInMonth(data.planned_date, month)
    if (data.kind === 'income' && data.is_essential !== undefined && data.is_essential !== null) {
      throw new AppError(400, 'is_essential só se aplica a despesas')
    }
    if (data.category_id) await assertCategoryForKind(data.category_id, userId, data.kind)

    const { monthStart } = monthBounds(month)
    const itemId = await withTransaction(async (client) => {
      const plan = await plansRepository.lockPlan(userId, monthStart, client)
      return plansRepository.insertManualItem(
        plan.id,
        userId,
        {
          kind: data.kind,
          description: data.description,
          category_id: data.category_id ?? null,
          planned_amount_cents: data.planned_amount_cents,
          planned_date: data.planned_date ?? null,
          is_essential: data.kind === 'expense' ? (data.is_essential ?? null) : null,
        },
        client,
      )
    })
    const [item] = await plansRepository.findItemViewsByIds([itemId], userId)
    return item
  },

  async updateItem(id: string, userId: string, data: UpdateItemInput): Promise<PlanItemView> {
    const context = await plansRepository.findItemContext(id, userId)
    if (!context) {
      throw new NotFoundError('linha do plano não encontrada')
    }

    const editable: readonly string[] =
      context.source_type === null
        ? EDITABLE_MANUAL
        : context.source_type === 'invoice'
          ? EDITABLE_INVOICE
          : EDITABLE_LINKED
    const notEditable = Object.keys(data).filter((key) => !editable.includes(key))
    if (notEditable.length > 0) {
      throw new AppError(
        400,
        context.source_type === null
          ? `campo não editável: ${notEditable.join(', ')}`
          : `campo não editável em linha vinculada: ${notEditable.join(', ')} (só ${editable.join(' e ')})`,
      )
    }

    if (data.planned_date) assertDateInMonth(data.planned_date, context.plan_month)
    if (context.source_type === null) {
      if (
        data.is_essential !== undefined &&
        data.is_essential !== null &&
        context.kind === 'income'
      ) {
        throw new AppError(400, 'is_essential só se aplica a despesas')
      }
      if (data.category_id) await assertCategoryForKind(data.category_id, userId, context.kind)
    }

    const updated = await plansRepository.updateItemFields(
      id,
      userId,
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    )
    if (!updated) {
      throw new NotFoundError('linha do plano não encontrada')
    }
    const [item] = await plansRepository.findItemViewsByIds([id], userId)
    return item
  },

  async deleteItem(id: string, userId: string): Promise<void> {
    const deleted = await plansRepository.deleteItem(id, userId)
    if (!deleted) {
      throw new NotFoundError('linha do plano não encontrada')
    }
  },

  async linkItems(userId: string, month: string, input: LinkItemsInput): Promise<LinkResult> {
    const { monthStart, monthEnd } = monthBounds(month)
    const today = todayInSaoPaulo()
    const ignored: LinkResult['ignored'] = []

    // Duplicata dentro do próprio pedido: a primeira vale, as demais são ignoradas.
    const seen = new Set<string>()
    const unique: { type: PlanSourceType; id: string }[] = []
    for (const source of input.sources) {
      const key = `${source.type}:${source.id}`
      if (seen.has(key)) {
        ignored.push({ ...source, reason: 'duplicate_in_request' })
        continue
      }
      seen.add(key)
      unique.push(source)
    }

    const ids: Record<PlanSourceType, string[]> = { income_entry: [], expense: [], invoice: [] }
    for (const source of unique) ids[source.type].push(source.id)

    // Posse: qualquer origem que não seja do usuário (inexistente ou alheia; fatura via cartão)
    // derruba o pedido inteiro com 404, sem gravar nada e sem revelar a diferença.
    const owned = await plansRepository.findOwnedSources(userId, ids)
    const ownedByKey = new Map(owned.map((source) => [`${source.type}:${source.id}`, source]))
    if (unique.some((source) => !ownedByKey.has(`${source.type}:${source.id}`))) {
      throw new NotFoundError('lançamento ou fatura não encontrado')
    }

    const plan = await plansRepository.findPlan(userId, monthStart)
    const alreadyPlanned = await plansRepository.findPlannedSources(userId, ids)

    const eligible: OwnedSource[] = []
    for (const { type, id } of unique) {
      const source = ownedByKey.get(`${type}:${id}`) as OwnedSource
      const planId = alreadyPlanned.get(`${type}:${id}`)
      if (planId) {
        const reason: LinkIgnoredReason =
          plan && planId === plan.id ? 'already_in_this_plan' : 'already_in_other_plan'
        ignored.push({ type, id, reason })
      } else if (!isInCandidatePeriod(source, monthStart, monthEnd, today)) {
        ignored.push({ type, id, reason: 'out_of_period' })
      } else {
        eligible.push(source)
      }
    }
    if (eligible.length === 0) {
      return { added: [], ignored }
    }

    // Ordem fixa das inserções: dois pedidos concorrentes com as mesmas origens nunca se travam
    // em ordem cruzada (sem deadlock).
    const ordered = [...eligible].sort((left, right) =>
      `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
    )
    const outcome = await withTransaction(async (client) => {
      // Trava do plano (mês): a segunda requisição só segue depois que a primeira confirmar.
      const target = await plansRepository.lockPlan(userId, monthStart, client)
      const created: string[] = []
      const lost: LinkResult['ignored'] = []
      for (const source of ordered) {
        const itemId = await plansRepository.insertLinkedItem(target.id, userId, source, client)
        if (itemId) {
          created.push(itemId)
          continue
        }
        // null = a origem já está em algum plano (outra requisição concorrente). Conflito tratado,
        // nunca 500: informa em qual plano ela está.
        const ids: Record<PlanSourceType, string[]> = { income_entry: [], expense: [], invoice: [] }
        ids[source.type].push(source.id)
        const where = await plansRepository.findPlannedSources(userId, ids, client)
        lost.push({
          type: source.type,
          id: source.id,
          reason:
            where.get(`${source.type}:${source.id}`) === target.id
              ? 'already_in_this_plan'
              : 'already_in_other_plan',
        })
      }
      return { created, lost }
    })
    return {
      added: await plansRepository.findItemViewsByIds(outcome.created, userId),
      ignored: [...ignored, ...outcome.lost],
    }
  },

  // Resumo do mês: todos os números, calculados aqui (o front só apresenta). Dinheiro em centavos
  // inteiros. Consultas por chamada: constante (não cresce com linhas nem categorias).
  async getSummary(userId: string, month: string) {
    const today = todayInSaoPaulo()
    const { monthStart, monthEnd } = monthBounds(month)
    // Janela realizada: do dia 1 até min(fim do mês, hoje). Mês futuro: vazia (windowTo = dia 0).
    const dayBeforeStart = addDays(monthStart, -1)
    const capped = today < monthEnd ? today : monthEnd
    const windowTo = capped > dayBeforeStart ? capped : dayBeforeStart
    const afterFrom = addDays(windowTo, 1)
    const period = today > monthEnd ? 'past' : today < monthStart ? 'future' : 'current'

    return withReadSnapshot(async (client) => {
      const plan = await plansRepository.findPlan(userId, monthStart, client)
      const rawItems = plan ? await plansRepository.listItems(plan.id, userId, client) : []
      const aggregates = await plansRepository.getMovementAggregates(
        userId,
        monthStart,
        windowTo,
        afterFrom,
        client,
      )
      const dailyNet = await plansRepository.getDailyNet(userId, monthStart, windowTo, client)
      const spent = await plansRepository.getCategorySpent(userId, monthStart, monthEnd, client)
      const invoiceCategories = plan
        ? await plansRepository.getInvoiceInstallmentsByCategory(
            plan.id,
            userId,
            monthStart,
            client,
          )
        : []
      const pendingBefore = await plansRepository.getPendingBeforeMonth(userId, monthStart, client)
      const notInPlan = await plansRepository.getNotInPlanAlerts(
        userId,
        monthStart,
        monthEnd,
        today,
        client,
      )

      const settings = settingsView(plan, month)
      const lines = rawItems.map((item) => classifyItem(item, monthStart, today))
      const totals = plannedTotals(lines)

      // Saldos (D1 = C, contas ativas): abertura = tudo o que foi liquidado antes do dia 1.
      const openingBalance = aggregates.initial + aggregates.before_net
      const todayBalance = aggregates.initial + aggregates.all_net
      const startBalance = settings.include_opening_balance ? openingBalance : 0

      const timeline = buildTimeline({
        lines,
        monthStart,
        monthEnd,
        today,
        windowTo,
        startBalance,
        dailyNet,
      })
      const projectedEnd = startBalance + totals.result

      const health = computeHealth({
        lineCount: lines.length,
        countedCount: lines.filter((line) => line.counts_in_month).length,
        inflow: totals.inflow,
        result: totals.result,
        minBalanceCents: timeline.min_balance.cents,
      })
      const gapToZero = Math.max(0, -totals.result)
      const gapToCashZero = Math.max(0, -timeline.min_balance.cents)

      const realizedPaid = aggregates.expenses_paid + aggregates.invoice_payments

      // Comparação por categoria (competência): planejado = linhas de despesa (manuais e vinculadas,
      // todas, contem ou não no caixa) + parcelas das faturas incluídas; realizado = Orçamentos.
      const plannedByCategory = new Map<
        string,
        { name: string; icon: string | null; cents: number; mismatch: boolean }
      >()
      const addPlanned = (
        id: string,
        name: string,
        icon: string | null,
        cents: number,
        mismatch: boolean,
      ) => {
        const current = plannedByCategory.get(id)
        if (current) {
          current.cents += cents
          current.mismatch = current.mismatch || mismatch
        } else {
          plannedByCategory.set(id, { name, icon, cents, mismatch })
        }
      }
      for (const line of lines) {
        if (line.kind !== 'expense' || line.source_type === 'invoice' || !line.category) continue
        addPlanned(
          line.category.id,
          line.category.name,
          line.category.icon,
          line.planned_amount_cents,
          false,
        )
      }
      for (const row of invoiceCategories) {
        addPlanned(row.category_id, row.name, row.icon, row.total, row.mismatch)
      }
      const byCategory = buildByCategory(plannedByCategory, spent)

      const cutSuggestions = buildCutSuggestions(lines, gapToZero, gapToCashZero)

      const settledAfterWindow = aggregates.after_net
      const computedToday =
        openingBalance +
        aggregates.received -
        aggregates.expenses_paid -
        aggregates.invoice_payments -
        aggregates.goal_contributions +
        aggregates.transfers_net +
        settledAfterWindow

      return {
        month,
        today,
        period,
        settings,
        opening_balance: openingBalance,
        today_balance: todayBalance,
        planned: {
          inflow: totals.inflow,
          outflow: totals.outflow,
          result: totals.result,
          projected_end_balance: projectedEnd,
          min_balance: timeline.min_balance,
          undated_count: timeline.undated_count,
        },
        realized: {
          received: aggregates.received,
          paid: realizedPaid,
          expenses_paid: aggregates.expenses_paid,
          invoice_payments: aggregates.invoice_payments,
          result: aggregates.received - realizedPaid,
          other_outflows: aggregates.goal_contributions,
          progress: {
            received_bps: progressBps(aggregates.received, totals.inflow),
            paid_bps: progressBps(realizedPaid, totals.outflow),
          },
          window: windowTo >= monthStart ? { from: monthStart, to: windowTo } : null,
        },
        health,
        gap_to_zero: gapToZero,
        gap_to_cash_zero: gapToCashZero,
        timeline: timeline.points,
        by_category: byCategory,
        alerts: {
          not_in_plan: {
            pending_income_count: notInPlan.pending_income_count,
            pending_expense_count: notInPlan.pending_expense_count,
            invoices_count: notInPlan.invoices_count,
            income_cents: notInPlan.pending_income_cents,
            expense_cents: notInPlan.pending_expense_cents,
            invoices_cents: notInPlan.invoices_cents,
            // Saídas fora do plano (despesas pendentes + faturas a pagar), em centavos.
            cents: notInPlan.pending_expense_cents + notInPlan.invoices_cents,
          },
          unplanned_categories: byCategory
            .filter((row) => row.status === 'unplanned')
            .map((row) => ({
              category_id: row.category_id,
              name: row.name,
              realized: row.realized,
            })),
        },
        cut_suggestions: cutSuggestions,
        // Pendências reais de meses anteriores (fora da abertura): aviso do mês futuro.
        pending_before_month: pendingBefore,
        reconciliation: {
          opening_balance: openingBalance,
          received: aggregates.received,
          expenses_paid: aggregates.expenses_paid,
          invoice_payments: aggregates.invoice_payments,
          goal_contributions: aggregates.goal_contributions,
          net_transfers: aggregates.transfers_net,
          settled_after_window: settledAfterWindow,
          computed_today_balance: computedToday,
          today_balance: todayBalance,
          difference: todayBalance - computedToday,
          window: { from: monthStart, to: windowTo },
          after_from: afterFrom,
        },
        counts: {
          lines: lines.length,
          counted: lines.filter((line) => line.counts_in_month).length,
          not_counted: lines.filter((line) => !line.counts_in_month).length,
        },
        items: lines,
      }
    })
  },

  async listCandidates(userId: string, month: string, query: CandidatesQuery) {
    const { monthStart, monthEnd } = monthBounds(month)
    const result = await plansRepository.listCandidates(userId, {
      kind: query.kind,
      status: query.status,
      search: query.search,
      monthStart,
      monthEnd,
      today: todayInSaoPaulo(),
      page: query.page,
      pageSize: query.pageSize,
    })
    return {
      candidates: result.items satisfies CandidateView[],
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  },

  // Ordem: 'planned' e 'invoices' primeiro (linhas vinculadas), 'fixed_previous_month' por último
  // (linhas manuais deduplicadas contra tudo que já está no plano, inclusive o que acabou de
  // entrar). dry_run percorre o MESMO caminho sem gravar, então as contagens são as do import real.
  async importItems(userId: string, month: string, input: ImportInput): Promise<ImportResult> {
    const { monthStart, monthEnd } = monthBounds(month)
    const dryRun = input.dry_run
    const includeSettled = input.include_settled
    const today = todayInSaoPaulo()

    const run = async (db: PoolClient | null): Promise<ImportResult> => {
      const dbOrPool = db ?? pool
      let planId: string | null = null
      if (db) {
        // Trava do plano: dois imports (duplo clique) executam em série, e o segundo enxerga as
        // linhas do primeiro (as fixas não duplicam).
        planId = (await plansRepository.lockPlan(userId, monthStart, db)).id
      }
      const sources: ImportResult['sources'] = {}
      let total = 0

      if (input.sources.includes('planned')) {
        const perKind = {} as Record<'income' | 'expense', ImportSettledCounts>
        for (const kind of ['income', 'expense'] as const) {
          const counts = await plansRepository.countPlannedImport(
            kind,
            userId,
            monthStart,
            monthEnd,
            today,
            includeSettled,
            dbOrPool,
          )
          const added =
            db && planId
              ? await plansRepository.insertPlannedImport(
                  kind,
                  planId,
                  userId,
                  monthStart,
                  monthEnd,
                  today,
                  includeSettled,
                  db,
                )
              : counts.to_add
          perKind[kind] = {
            added,
            overdue_previous_months: counts.overdue_previous,
            skipped_already_in_plan: counts.already,
            skipped_settled: counts.settled_excluded,
          }
        }
        const added = perKind.income.added + perKind.expense.added
        sources.planned = {
          added,
          overdue_previous_months:
            perKind.income.overdue_previous_months + perKind.expense.overdue_previous_months,
          income: perKind.income,
          expense: perKind.expense,
        }
        total += added
      }

      if (input.sources.includes('invoices')) {
        const counts = await plansRepository.countInvoiceImport(
          userId,
          monthStart,
          monthEnd,
          dbOrPool,
        )
        const added =
          db && planId
            ? await plansRepository.insertInvoiceImport(planId, userId, monthStart, monthEnd, db)
            : counts.to_add
        sources.invoices = {
          added,
          skipped_already_in_plan: counts.already,
          paid_included: counts.paid_included,
        }
        total += added
      }

      if (input.sources.includes('fixed_previous_month')) {
        const previous = monthBounds(previousMonth(month))
        const found = await plansRepository.findFixedOfMonth(
          userId,
          previous.monthStart,
          previous.monthEnd,
          dbOrPool,
        )

        // O que já está no plano (derivado dos lançamentos, nas linhas vinculadas).
        const existing = new Set<string>()
        const plan = await plansRepository.findPlan(userId, monthStart, dbOrPool)
        if (plan) {
          for (const item of await plansRepository.listItems(plan.id, userId, dbOrPool)) {
            existing.add(
              dedupeKey(
                item.kind,
                item.description,
                item.category?.id ?? null,
                item.planned_amount_cents,
              ),
            )
          }
        }
        // dry_run: acrescenta o que o 'planned' ACRESCENTARIA (no import real já está no plano).
        if (dryRun && input.sources.includes('planned')) {
          for (const kind of ['income', 'expense'] as const) {
            const keys = await plansRepository.listPlannedImportKeys(
              kind,
              userId,
              monthStart,
              monthEnd,
              today,
              includeSettled,
              dbOrPool,
            )
            for (const key of keys) {
              existing.add(dedupeKey(kind, key.description, key.category_id, key.amount_cents))
            }
          }
        }

        let added = 0
        let duplicates = 0
        for (const row of found) {
          const description = truncateDescription(row.description)
          const key = dedupeKey(row.kind, description, row.category_id, row.amount_cents)
          if (existing.has(key)) {
            duplicates += 1
            continue
          }
          existing.add(key)
          added += 1
          if (db && planId) {
            await plansRepository.insertManualItem(
              planId,
              userId,
              {
                kind: row.kind,
                description,
                category_id: row.category_id,
                planned_amount_cents: row.amount_cents,
                planned_date: shiftDateOneMonthClamped(row.date),
                is_essential: row.kind === 'expense' ? row.is_essential : null,
              },
              db,
            )
          }
        }
        sources.fixed_previous_month = {
          added,
          found: found.length,
          skipped_duplicates: duplicates,
        }
        total += added
      }

      return { dry_run: dryRun, month, sources, total_added: total }
    }

    if (dryRun) return run(null)
    return withTransaction((client) => run(client))
  },
}
