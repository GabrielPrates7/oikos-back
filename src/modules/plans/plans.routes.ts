import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import {
  createItem,
  getMonth,
  getSummary,
  importItems,
  linkItems,
  listCandidates,
  removeItem,
  updateItem,
  updateSettings,
} from './plans.controller.js'

export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/:month', getMonth)
  app.get('/:month/summary', getSummary)
  app.put('/:month/settings', updateSettings)
  app.post('/:month/items', createItem)
  app.post('/:month/items/link', linkItems)
  app.get('/:month/candidates', listCandidates)
  app.post('/:month/import', importItems)
  app.put('/items/:id', updateItem)
  app.delete('/items/:id', removeItem)
}
