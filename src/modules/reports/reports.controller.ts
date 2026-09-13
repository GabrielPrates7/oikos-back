import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  byAccountQuerySchema,
  byCategoryQuerySchema,
  comparisonQuerySchema,
  monthOnlyQuerySchema,
  monthlyEvolutionQuerySchema,
  spendingTrendsQuerySchema,
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

export async function byAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const query = byAccountQuerySchema.parse(request.query)
  const result = await reportsService.getByAccount(request.user!.id, query.month, query.type)
  reply.send(result)
}

export async function byReceiptMethod(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { month } = monthOnlyQuerySchema.parse(request.query)
  const result = await reportsService.getByReceiptMethod(request.user!.id, month)
  reply.send(result)
}

export async function essentialVsSuperfluous(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { month } = monthOnlyQuerySchema.parse(request.query)
  const result = await reportsService.getEssentialVsSuperfluous(request.user!.id, month)
  reply.send(result)
}

export async function fixedVsNonFixed(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { month } = monthOnlyQuerySchema.parse(request.query)
  const result = await reportsService.getFixedVsNonFixed(request.user!.id, month)
  reply.send(result)
}

export async function spendingTrends(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { month, monthsBack } = spendingTrendsQuerySchema.parse(request.query)
  const result = await reportsService.getSpendingTrends(request.user!.id, month, monthsBack)
  reply.send(result)
}
