import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { getById, list, pay } from './invoices.controller.js'

export async function invoicesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.get('/:id', getById)
  app.post('/:id/pay', pay)
}
