import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  accountStatusQuerySchema,
  createAccountSchema,
  updateAccountSchema,
} from './accounts.schema.js'
import { accountsService } from './accounts.service.js'

const listQuerySchema = z.object({
  status: accountStatusQuerySchema.optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { status } = listQuerySchema.parse(request.query)
  const accounts = await accountsService.listByUser(request.user!.id, status)
  reply.send({ accounts })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createAccountSchema.parse(request.body)
  const account = await accountsService.create(request.user!.id, body)
  reply.code(201).send({ account })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const account = await accountsService.getById(id, request.user!.id)
  reply.send({ account })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateAccountSchema.parse(request.body)
  const account = await accountsService.update(id, request.user!.id, body)
  reply.send({ account })
}

export async function archive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await accountsService.archive(id, request.user!.id)
  reply.code(204).send()
}

export async function getBalance(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const balance = await accountsService.getBalance(id, request.user!.id)
  reply.send(balance)
}
