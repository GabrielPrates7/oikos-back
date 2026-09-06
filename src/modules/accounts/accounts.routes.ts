import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import {
  activate,
  archive,
  create,
  getBalance,
  getById,
  getStatement,
  list,
  update,
} from './accounts.controller.js'

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', archive)
  app.post('/:id/activate', activate)
  app.get('/:id/balance', getBalance)
  app.get('/:id/statement', getStatement)
}
