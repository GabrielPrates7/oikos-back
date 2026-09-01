import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { create, getById, list, remove, update } from './categories.controller.js'

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', remove)
}
