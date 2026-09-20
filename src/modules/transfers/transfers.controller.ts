import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import { createTransferSchema, updateTransferSchema } from './transfers.schema.js'
import { transfersService } from './transfers.service.js'

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = listQuerySchema.parse(request.query)
  const result = await transfersService.listByUser(
    request.user!.id,
    { accountId: query.accountId, dateFrom: query.from, dateTo: query.to },
    { page: query.page, pageSize: query.pageSize },
  )
  reply.send({
    transfers: result.items,
    total: result.total,
    sumCents: result.sumCents,
    page: result.page,
    pageSize: result.pageSize,
  })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createTransferSchema.parse(request.body)
  const transfer = await transfersService.create(request.user!.id, body)
  reply.code(201).send({ transfer })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const transfer = await transfersService.getById(id, request.user!.id)
  reply.send({ transfer })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateTransferSchema.parse(request.body)
  const transfer = await transfersService.update(id, request.user!.id, body)
  reply.send({ transfer })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await transfersService.delete(id, request.user!.id)
  reply.code(204).send()
}
