import type { FastifyReply, FastifyRequest } from 'fastify'
import { monthQuerySchema } from './dashboard.schema.js'
import { dashboardService } from './dashboard.service.js'

export async function getSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { month } = monthQuerySchema.parse(request.query)
  const summary = await dashboardService.getSummary(request.user!.id, month)
  reply.send(summary)
}
