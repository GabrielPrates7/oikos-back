import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { getSummary } from './dashboard.controller.js'

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/summary', getSummary)
}
