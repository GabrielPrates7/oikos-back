import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createGoalSchema, updateGoalSchema } from './goals.schema.js'
import { goalsService } from './goals.service.js'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const goals = await goalsService.listByUser(request.user!.id)
  reply.send({ goals })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createGoalSchema.parse(request.body)
  const goal = await goalsService.create(request.user!.id, body)
  reply.code(201).send({ goal })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const goal = await goalsService.getDetail(request.user!.id, id)
  reply.send({ goal })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateGoalSchema.parse(request.body)
  const goal = await goalsService.update(id, request.user!.id, body)
  reply.send({ goal })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await goalsService.delete(id, request.user!.id)
  reply.code(204).send()
}
