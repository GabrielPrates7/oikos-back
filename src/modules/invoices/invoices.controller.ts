import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { payInvoiceSchema } from './invoices.schema.js'
import { invoicesService } from './invoices.service.js'

// 'all' = sem filtro de mês; 'YYYY-MM' = mês exato; ausente = padrão (mês atual + não paga
// de mês anterior), resolvido dentro de invoices.repository.buildWhere.
const monthQuerySchema = z.union([z.literal('all'), z.string().regex(/^\d{4}-\d{2}$/)])

const listQuerySchema = z.object({
  creditCardId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  month: monthQuerySchema.optional(),
  sort: z.enum(['value_asc', 'value_desc']).default('value_desc'),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { creditCardId, search, month, sort, page, pageSize } = listQuerySchema.parse(request.query)
  const result = await invoicesService.listForUser(
    request.user!.id,
    { creditCardId, search, month },
    { page, pageSize },
    sort,
  )
  reply.send({
    invoices: result.items,
    total: result.total,
    sumCents: result.sumCents,
    page: result.page,
    pageSize: result.pageSize,
  })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const invoice = await invoicesService.getDetail(id, request.user!.id)
  reply.send({ invoice })
}

export async function pay(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = payInvoiceSchema.parse(request.body)
  const result = await invoicesService.payInvoice(request.user!.id, id, body)
  reply.send(result)
}
