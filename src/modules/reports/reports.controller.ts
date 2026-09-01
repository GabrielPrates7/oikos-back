import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  byCategoryQuerySchema,
  comparisonQuerySchema,
  monthlyEvolutionQuerySchema,
} from './reports.schema.js'
import { reportsService } from './reports.service.js'

export async function byCategory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = byCategoryQuerySchema.parse(request.query)
  const result = await reportsService.getByCategory(request.user!.id, query.month, query.type)
  reply.send(result)
}

export async function monthlyEvolution(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { monthsBack } = monthlyEvolutionQuerySchema.parse(request.query)
  const months = await reportsService.getMonthlyEvolution(request.user!.id, monthsBack)
  reply.send({ months })
}

export async function comparison(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month1, month2 } = comparisonQuerySchema.parse(request.query)
  const result = await reportsService.getComparison(request.user!.id, month1, month2)
  reply.send(result)
}
