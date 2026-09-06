import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createContributionSchema } from './contributions.schema.js'
import { contributionsService } from './contributions.service.js'

const goalParamsSchema = z.object({
  id: z.string().uuid(),
})

const contributionParamsSchema = z.object({
  id: z.string().uuid(),
  contributionId: z.string().uuid(),
})

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = goalParamsSchema.parse(request.params)
  const body = createContributionSchema.parse(request.body)
  const contribution = await contributionsService.create(request.user!.id, id, body)
  reply.code(201).send({ contribution })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id, contributionId } = contributionParamsSchema.parse(request.params)
  await contributionsService.delete(request.user!.id, id, contributionId)
  reply.code(204).send()
}
