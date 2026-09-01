import type { FastifyReply, FastifyRequest } from 'fastify'
import { createPurchaseSchema } from './purchases.schema.js'
import { purchasesService } from './purchases.service.js'

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createPurchaseSchema.parse(request.body)
  const result = await purchasesService.createPurchase(request.user!.id, body)
  reply.code(201).send(result)
}
