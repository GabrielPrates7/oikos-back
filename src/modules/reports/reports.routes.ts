import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { byCategory, comparison, monthlyEvolution } from './reports.controller.js'

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/by-category', byCategory)
  app.get('/monthly-evolution', monthlyEvolution)
  app.get('/comparison', comparison)
}
