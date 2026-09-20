import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import { create, getById, getMonthlySummary, getYears, list, remove, update } from './expenses.controller.js'

export async function expensesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/', list)
  app.get('/monthly-summary', getMonthlySummary)
  // Antes de '/:id' de propósito — senão '/years' seria capturado como :id="years".
  app.get('/years', getYears)
  app.post('/', create)
  app.get('/:id', getById)
  app.put('/:id', update)
  app.delete('/:id', remove)
}
