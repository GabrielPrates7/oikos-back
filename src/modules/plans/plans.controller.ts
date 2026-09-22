import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  candidatesQuerySchema,
  createManualItemSchema,
  importSchema,
  itemIdParamsSchema,
  linkItemsSchema,
  monthParamsSchema,
  updateItemSchema,
  updateSettingsSchema,
} from './plans.schema.js'
import { plansService } from './plans.service.js'

export async function getMonth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  reply.send(await plansService.getMonth(request.user!.id, month))
}

export async function updateSettings(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  const body = updateSettingsSchema.parse(request.body)
  const plan = await plansService.updateSettings(
    request.user!.id,
    month,
    body.include_opening_balance,
  )
  reply.send({ plan })
}

export async function createItem(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  const body = createManualItemSchema.parse(request.body)
  const item = await plansService.createManualItem(request.user!.id, month, body)
  reply.code(201).send({ item })
}

export async function updateItem(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = itemIdParamsSchema.parse(request.params)
  const body = updateItemSchema.parse(request.body)
  const item = await plansService.updateItem(id, request.user!.id, body)
  reply.send({ item })
}

export async function removeItem(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = itemIdParamsSchema.parse(request.params)
  await plansService.deleteItem(id, request.user!.id)
  reply.code(204).send()
}

export async function linkItems(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  const body = linkItemsSchema.parse(request.body)
  reply.send(await plansService.linkItems(request.user!.id, month, body))
}

export async function listCandidates(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  const query = candidatesQuerySchema.parse(request.query)
  reply.send(await plansService.listCandidates(request.user!.id, month, query))
}

export async function importItems(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  const body = importSchema.parse(request.body)
  reply.send(await plansService.importItems(request.user!.id, month, body))
}

export async function getSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthParamsSchema.parse(request.params)
  reply.send(await plansService.getSummary(request.user!.id, month))
}
