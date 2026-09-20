import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { create, getById, getYears, list, remove, update } from './income-entries.controller.js'

export async function incomeEntriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  // Antes de '/:id' de propósito — senão '/years' seria capturado como :id="years".
  app.get('/years', getYears)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', remove)
}
