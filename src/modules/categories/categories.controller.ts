import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  categoryTypeSchema,
  createCategorySchema,
  updateCategorySchema,
} from './categories.schema.js'
import { categoriesService } from './categories.service.js'

const listQuerySchema = z.object({
  type: categoryTypeSchema.optional(),
})

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { type } = listQuerySchema.parse(request.query)
  const categories = await categoriesService.listVisibleToUser(request.user!.id, type)
  reply.send({ categories })
}

export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = createCategorySchema.parse(request.body)
  const category = await categoriesService.create(request.user!.id, body)
  reply.code(201).send({ category })
}

export async function getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const category = await categoriesService.getVisibleById(id, request.user!.id)
  reply.send({ category })
}

export async function update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  const body = updateCategorySchema.parse(request.body)
  const category = await categoriesService.update(id, request.user!.id, body)
  reply.send({ category })
}

export async function remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = idParamsSchema.parse(request.params)
  await categoriesService.delete(id, request.user!.id)
  reply.code(204).send()
}
