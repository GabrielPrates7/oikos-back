import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import { payInvoiceSchema } from './invoices.schema.js'
import { invoicesService } from './invoices.service.js'

// Mês, Ano e Status são filtros INDEPENDENTES: month = número do mês ('01'..'12') ou 'all'
// (ausente = todos os meses), year = 'YYYY', status = 'unpaid' | 'paid'.
const monthQuerySchema = z.union([z.literal('all'), z.string().regex(/^(0[1-9]|1[0-2])$/)])

const listQuerySchema = z.object({
  creditCardId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  month: monthQuerySchema.optional(),
  year: z.string().regex(/^[0-9]{4}$/).optional(),
  status: z.enum(['unpaid', 'paid']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  sort: z.enum(['value_asc', 'value_desc']).default('value_desc'),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { creditCardId, search, month, year, status, from, to, sort, page, pageSize } =
    listQuerySchema.parse(request.query)
  const result = await invoicesService.listForUser(
    request.user!.id,
    { creditCardId, search, month, year, status, dueFrom: from, dueTo: to },
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
