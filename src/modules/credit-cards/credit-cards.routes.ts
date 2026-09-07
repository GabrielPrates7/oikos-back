import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import {
  activate,
  archive,
  create,
  deletePermanently,
  getAvailableLimit,
  getById,
  list,
  listPurchases,
  update,
} from './credit-cards.controller.js'

export async function creditCardsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', archive)
  app.delete('/:id/permanent', deletePermanently)
  app.post('/:id/activate', activate)
  app.get('/:id/available-limit', getAvailableLimit)
  app.get('/:id/purchases', listPurchases)
}
