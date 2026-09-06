import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { create, update } from './purchases.controller.js'

export async function purchasesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.post('/', create)
  app.put('/:id', update)
}
