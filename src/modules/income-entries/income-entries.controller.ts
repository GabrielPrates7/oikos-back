import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentMonthString, monthRange } from '../../utils/date-range.js'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import { createIncomeEntrySchema, updateIncomeEntrySchema } from './income-entries.schema.js'
import { incomeEntriesService } from './income-entries.service.js'

// Mesmo padrão de expenses.controller (ver comentário lá): 'all' = sem filtro; 'YYYY-MM' =
// mês exato; ausente = mês atual. Resolvido aqui, não no repository, por causa do chamador
// interno accounts.service.getStatement que passa dateFrom/dateTo direto.
const monthQuerySchema = z.union([z.literal('all'), z.string().regex(/^\d{4}-\d{2}$/)])

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  // Omitido = todas. pending = ainda não recebida.
  status: z.enum(['pending', 'received']).optional(),
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

// from/to explícitos sempre ganham do month — mesmo motivo de expenses.controller.
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
  const result = await incomeEntriesService.listByUser(
    request.user!.id,
    {
      accountId: query.accountId,
      categoryId: query.categoryId,
      dateFrom,
      dateTo,
      status: query.status,
      fixed: query.fixed,
    },
    { page: query.page, pageSize: query.pageSize },
  )
  reply.send({
    incomeEntries: result.items,
    total: result.total,
    sumCents: result.sumCents,
    // 'pending' quando status=pending: sumCents é a soma dos PENDENTES (o front troca o rótulo
    // do card pra "Total pendente"). Nos demais casos 'default' = soma de sempre (recebidas).
    sumMode: query.status === 'pending' ? 'pending' : 'default',
    page: result.page,
    pageSize: result.pageSize,
  })
}

export async function getYears(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const years = await incomeEntriesService.getAvailableYears(request.user!.id)
  reply.send({ years })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createIncomeEntrySchema.parse(request.body)
  const incomeEntry = await incomeEntriesService.create(request.user!.id, body)
  reply.code(201).send({ incomeEntry })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const incomeEntry = await incomeEntriesService.getById(id, request.user!.id)
  reply.send({ incomeEntry })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateIncomeEntrySchema.parse(request.body)
  const incomeEntry = await incomeEntriesService.update(id, request.user!.id, body)
  reply.send({ incomeEntry })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await incomeEntriesService.delete(id, request.user!.id)
  reply.code(204).send()
}
