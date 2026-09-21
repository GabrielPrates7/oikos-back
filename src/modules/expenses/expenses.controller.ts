import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentMonthString, monthRange } from '../../utils/date-range.js'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import { createExpenseSchema, paymentMethodSchema, updateExpenseSchema } from './expenses.schema.js'
import { expensesService } from './expenses.service.js'

// 'all' = sem filtro de mês; 'YYYY-MM' = mês exato; ausente = mês atual. Mesmo padrão de
// invoices.controller, mas resolvido aqui (não no repository): expenses/income-entries têm
// um chamador interno (accounts.service.getStatement) que monta seu próprio dateFrom/dateTo
// direto no repository, sem passar pelo controller — colocar o default no repository
// afetaria esse chamador também.
const monthQuerySchema = z.union([z.literal('all'), z.string().regex(/^\d{4}-\d{2}$/)])

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  // Omitido = todos. pending = ainda não paga; essential/planned mapeiam is_essential/is_planned.
  status: z.enum(['pending', 'paid']).optional(),
  essential: z.enum(['essential', 'superfluous']).optional(),
  planned: z.enum(['planned', 'unplanned']).optional(),
  // Omitido = todas. fixed = só recorrentes (is_fixed).
  fixed: z.enum(['fixed', 'unfixed']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  month: monthQuerySchema.optional(),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const monthlySummaryQuerySchema = z.object({
  month: monthQuerySchema.optional(),
})

// from/to explícitos sempre ganham do month — evita ANDar um range custom de outro mês com
// o default de mês atual, o que só produziria uma lista vazia sem explicação nenhuma.
function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
  month: string | undefined,
): { dateFrom: string | undefined; dateTo: string | undefined } {
  if (from !== undefined || to !== undefined) {
    return { dateFrom: from, dateTo: to }
  }
  const effectiveMonth = month ?? currentMonthString()
  if (effectiveMonth === 'all') {
    return { dateFrom: undefined, dateTo: undefined }
  }
  const { monthStart, monthEnd } = monthRange(effectiveMonth)
  return { dateFrom: monthStart, dateTo: monthEnd }
}

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = listQuerySchema.parse(request.query)
  const { dateFrom, dateTo } = resolveDateRange(query.from, query.to, query.month)
  const result = await expensesService.listByUser(
    request.user!.id,
    {
      accountId: query.accountId,
      categoryId: query.categoryId,
      paymentMethod: query.paymentMethod,
      dateFrom,
      dateTo,
      status: query.status,
      essential: query.essential,
      planned: query.planned,
      fixed: query.fixed,
    },
    { page: query.page, pageSize: query.pageSize },
  )
  reply.send({
    expenses: result.items,
    total: result.total,
    sumCents: result.sumCents,
    // 'pending' quando status=pending: sumCents é a soma dos PENDENTES; senão 'default' (pagas).
    sumMode: query.status === 'pending' ? 'pending' : 'default',
    page: result.page,
    pageSize: result.pageSize,
  })
}

export async function getMonthlySummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthlySummaryQuerySchema.parse(request.query)
  const summary = await expensesService.getMonthlySummary(request.user!.id, month ?? currentMonthString())
  reply.send(summary)
}

export async function getYears(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const years = await expensesService.getAvailableYears(request.user!.id)
  reply.send({ years })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createExpenseSchema.parse(request.body)
  const expense = await expensesService.create(request.user!.id, body)
  reply.code(201).send({ expense })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const expense = await expensesService.getById(id, request.user!.id)
  reply.send({ expense })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateExpenseSchema.parse(request.body)
  const expense = await expensesService.update(id, request.user!.id, body)
  reply.send({ expense })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await expensesService.delete(id, request.user!.id)
  reply.code(204).send()
}
