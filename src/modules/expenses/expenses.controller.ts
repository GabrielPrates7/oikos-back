import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isoDateSchema } from '../../utils/validation.js'
import { createExpenseSchema, paymentMethodSchema, updateExpenseSchema } from './expenses.schema.js'
import { expensesService } from './expenses.service.js'

const listQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = listQuerySchema.parse(request.query)
  const expenses = await expensesService.listByUser(request.user!.id, {
    accountId: query.accountId,
    categoryId: query.categoryId,
    paymentMethod: query.paymentMethod,
    dateFrom: query.from,
    dateTo: query.to,
  })
  reply.send({ expenses })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createExpenseSchema.parse(request.body)
  const expense = await expensesService.create(request.user!.id, body)
  reply.code(201).send({ expense })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const expense = await expensesService.getById(id, request.user!.id)
  reply.send({ expense })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateExpenseSchema.parse(request.body)
  const expense = await expensesService.update(id, request.user!.id, body)
  reply.send({ expense })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await expensesService.delete(id, request.user!.id)
  reply.code(204).send()
}
