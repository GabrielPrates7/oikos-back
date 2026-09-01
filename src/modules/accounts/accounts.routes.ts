import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { archive, create, getBalance, getById, list, update } from './accounts.controller.js'

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', archive)
  app.get('/:id/balance', getBalance)
}
