import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { paginationQuerySchema } from '../../utils/pagination.js'
import { isoDateSchema } from '../../utils/validation.js'
import {
  accountStatusQuerySchema,
  createAccountSchema,
  updateAccountSchema,
} from './accounts.schema.js'
import { accountsService } from './accounts.service.js'

const listQuerySchema = z.object({
  status: accountStatusQuerySchema.optional(),
  ...paginationQuerySchema,
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const statementQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { status, page, pageSize } = listQuerySchema.parse(request.query)
  const result = await accountsService.listByUser(request.user!.id, status, { page, pageSize })
  reply.send({
    accounts: result.items,
    total: result.total,
    sumCents: result.sumCents,
    page: result.page,
    pageSize: result.pageSize,
  })
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

export async function activate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await accountsService.activate(id, request.user!.id)
  reply.code(204).send()
}

export async function deletePermanently(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await accountsService.deletePermanently(id, request.user!.id)
  reply.code(204).send()
}

export async function getBalance(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const balance = await accountsService.getBalance(id, request.user!.id)
  reply.send(balance)
}

export async function getStatement(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const { from, to } = statementQuerySchema.parse(request.query)
  const statement = await accountsService.getStatement(request.user!.id, id, from, to)
  reply.send(statement)
}
