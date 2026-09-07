import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { purchasesService } from '../purchases/purchases.service.js'
import {
  createCreditCardSchema,
  creditCardStatusQuerySchema,
  updateCreditCardSchema,
} from './credit-cards.schema.js'
import { creditCardsService } from './credit-cards.service.js'

const listQuerySchema = z.object({
  status: creditCardStatusQuerySchema.optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { status } = listQuerySchema.parse(request.query)
  const creditCards = await creditCardsService.listByUser(request.user!.id, status)
  reply.send({ creditCards })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createCreditCardSchema.parse(request.body)
  const creditCard = await creditCardsService.create(request.user!.id, body)
  reply.code(201).send({ creditCard })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const creditCard = await creditCardsService.getById(id, request.user!.id)
  reply.send({ creditCard })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateCreditCardSchema.parse(request.body)
  const creditCard = await creditCardsService.update(id, request.user!.id, body)
  reply.send({ creditCard })
}

export async function archive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await creditCardsService.archive(id, request.user!.id)
  reply.code(204).send()
}

export async function activate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await creditCardsService.activate(id, request.user!.id)
  reply.code(204).send()
}

export async function deletePermanently(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await creditCardsService.deletePermanently(id, request.user!.id)
  reply.code(204).send()
}

export async function getAvailableLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const limit = await creditCardsService.getAvailableLimit(id, request.user!.id)
  reply.send(limit)
}

export async function listPurchases(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const purchases = await purchasesService.listForCard(request.user!.id, id)
  reply.send({ purchases })
}
