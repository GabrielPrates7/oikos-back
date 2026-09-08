import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import { createIncomeEntrySchema, updateIncomeEntrySchema } from './income-entries.schema.js'
import { incomeEntriesService } from './income-entries.service.js'

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = listQuerySchema.parse(request.query)
  const result = await incomeEntriesService.listByUser(
    request.user!.id,
    { accountId: query.accountId, categoryId: query.categoryId, dateFrom: query.from, dateTo: query.to },
    { page: query.page, pageSize: query.pageSize },
  )
  reply.send({
    incomeEntries: result.items,
    total: result.total,
    sumCents: result.sumCents,
    page: result.page,
    pageSize: result.pageSize,
  })
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
