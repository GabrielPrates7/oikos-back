import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createPurchaseSchema, updatePurchaseSchema } from './purchases.schema.js'
import { purchasesService } from './purchases.service.js'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createPurchaseSchema.parse(request.body)
  const result = await purchasesService.createPurchase(request.user!.id, body)
  reply.code(201).send(result)
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updatePurchaseSchema.parse(request.body)
  const purchase = await purchasesService.update(id, request.user!.id, body)
  reply.send({ purchase })
}
