import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import * as contributionsController from './contributions.controller.js'
import { create, getById, list, remove, update } from './goals.controller.js'

export async function goalsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', remove)

  app.post('/:id/contributions', contributionsController.create)
  app.delete('/:id/contributions/:contributionId', contributionsController.remove)
}
