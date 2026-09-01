import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import {
  archive,
  create,
  getAvailableLimit,
  getById,
  list,
  update,
} from './credit-cards.controller.js'

export async function creditCardsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', archive)
  app.get('/:id/available-limit', getAvailableLimit)
}
