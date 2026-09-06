import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/auth.js'
import {
  byAccount,
  byCategory,
  comparison,
  essentialVsSuperfluous,
  fixedVsNonFixed,
  monthlyEvolution,
  byReceiptMethod,
} from './reports.controller.js'

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  app.get('/by-category', byCategory)
  app.get('/monthly-evolution', monthlyEvolution)
  app.get('/comparison', comparison)
  app.get('/by-account', byAccount)
  app.get('/by-receipt-method', byReceiptMethod)
  app.get('/essential-vs-superfluous', essentialVsSuperfluous)
  app.get('/fixed-vs-non-fixed', fixedVsNonFixed)
}
