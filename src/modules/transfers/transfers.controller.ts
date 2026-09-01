import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'
import { createTransferSchema } from './transfers.schema.js'
import { transfersService } from './transfers.service.js'

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = listQuerySchema.parse(request.query)
  const transfers = await transfersService.listByUser(request.user!.id, {
    accountId: query.accountId,
    dateFrom: query.from,
    dateTo: query.to,
  })
  reply.send({ transfers })
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

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await transfersService.delete(id, request.user!.id)
  reply.code(204).send()
}
