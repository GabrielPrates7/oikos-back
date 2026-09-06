import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createBudgetSchema, referenceMonthSchema, updateBudgetSchema } from './budgets.schema.js'
import { budgetsService } from './budgets.service.js'

const listQuerySchema = z.object({
  month: referenceMonthSchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = listQuerySchema.parse(request.query)
  const budgets = await budgetsService.listByUserAndMonth(request.user!.id, month)
  reply.send({ budgets })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createBudgetSchema.parse(request.body)
  const budget = await budgetsService.create(request.user!.id, body)
  reply.code(201).send({ budget })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateBudgetSchema.parse(request.body)
  const budget = await budgetsService.update(id, request.user!.id, body)
  reply.send({ budget })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await budgetsService.delete(id, request.user!.id)
  reply.code(204).send()
}
