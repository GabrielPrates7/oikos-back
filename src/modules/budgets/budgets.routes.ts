import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { create, list, remove, update } from './budgets.controller.js'

export async function budgetsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.put('/:id', update)
  app.delete('/:id', remove)
}
